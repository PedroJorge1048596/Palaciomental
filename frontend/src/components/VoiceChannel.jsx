import { useEffect, useRef, useState } from "react";
import { getSocket } from "../socket";
import { playJoinSound, playLeaveSound, playStreamSound } from "../sounds";
import {
  IconMic,
  IconMicOff,
  IconShareScreen,
  IconVideo,
  IconHeadphones,
  IconSettings,
  IconPhoneOff,
} from "./VoiceIcons.jsx";

const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// Paleta usada para gerar uma cor estável por participante remoto (não temos
// o avatar_color deles aqui, só o username vindo do socket).
const TILE_COLORS = [
  "#E5533D", "#3D8DE5", "#5DBE7A", "#C9A227",
  "#8B5CF6", "#EC7FA9", "#2FB6A8", "#E58A3D",
];
function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return TILE_COLORS[hash % TILE_COLORS.length];
}

export default function VoiceChannel({ channel, currentUser, hidden = false, isOwner = false }) {
  const [participants, setParticipants] = useState([]); // {id, username}
  const [connected, setConnected] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");
  const [sharingScreen, setSharingScreen] = useState(false);
  const [remoteScreens, setRemoteScreens] = useState({}); // socketId -> username (quem está compartilhando)
  const [expandedTile, setExpandedTile] = useState(null); // null | "local" | socketId — modo teatro
  const [ctxMenu, setCtxMenu] = useState(null); // {id, username, x, y} — menu de volume/mudo local

  // Volume/mudo LOCAL por pessoa — só afeta o que EU escuto, não é enviado a
  // ninguém. Guardado por username (não por socketId, que muda a cada
  // conexão) e persistido no localStorage pra sobreviver a reconexões.
  const [peerAudioPrefs, setPeerAudioPrefs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("voicePeerAudioPrefs") || "{}");
    } catch {
      return {};
    }
  });
  const peerAudioPrefsRef = useRef(peerAudioPrefs);
  useEffect(() => {
    peerAudioPrefsRef.current = peerAudioPrefs;
    localStorage.setItem("voicePeerAudioPrefs", JSON.stringify(peerAudioPrefs));
  }, [peerAudioPrefs]);

  const connectedRef = useRef(false); // espelha "connected" sem sofrer de closures desatualizadas
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const screenSendersRef = useRef({}); // socketId -> RTCRtpSender (faixa de vídeo da tela)
  const localVideoRef = useRef(null);
  const remoteVideoRefs = useRef({}); // socketId -> <video>
  const pendingScreenStreams = useRef({}); // socketId -> MediaStream (chegou antes do <video> montar)
  const peersRef = useRef({}); // socketId -> RTCPeerConnection
  const audioElsRef = useRef({}); // socketId -> <audio>
  const usernameForSocketRef = useRef({}); // socketId -> username (pra aplicar prefs de volume ao conectar)

  function applyAudioPrefs(socketId, username) {
    const audio = audioElsRef.current[socketId];
    if (!audio) return;
    const prefs = peerAudioPrefsRef.current[username];
    audio.volume = prefs?.volume != null ? prefs.volume / 100 : 1;
    audio.muted = !!prefs?.muted;
  }

  // Registra os listeners de voz UMA ÚNICA VEZ por canal — antes, eles eram
  // registrados dentro de join(), então cada "Entrar" depois de um "Sair"
  // empilhava um novo conjunto de listeners no mesmo socket, e cada evento
  // passava a disparar 2x, 3x... criando cópias fantasmas dos participantes.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    function onRoomUsers(users) {
      setParticipants(
        users.map((u) => ({
          id: u.socketId,
          username: u.username,
          avatarColor: u.avatarColor,
          avatarUrl: u.avatarUrl,
        }))
      );
      users.forEach((u) => {
        usernameForSocketRef.current[u.socketId] = u.username;
        createPeer(u.socketId, true);
      });
    }

    function onUserJoined(u) {
      usernameForSocketRef.current[u.socketId] = u.username;
      setParticipants((prev) =>
        prev.some((p) => p.id === u.socketId)
          ? prev
          : [
              ...prev,
              { id: u.socketId, username: u.username, avatarColor: u.avatarColor, avatarUrl: u.avatarUrl },
            ]
      );
    }

    function onUserLeft({ socketId }) {
      setParticipants((prev) => prev.filter((p) => p.id !== socketId));
      const pc = peersRef.current[socketId];
      if (pc) {
        pc.close();
        delete peersRef.current[socketId];
      }
      const audio = audioElsRef.current[socketId];
      if (audio) {
        audio.srcObject = null;
        delete audioElsRef.current[socketId];
      }
    }

    async function onSignal({ from, signal, user }) {
      if (user?.username) usernameForSocketRef.current[from] = user.username;
      let pc = peersRef.current[from];
      if (!pc) {
        pc = createPeerConnection(from, user?.username);
      }
      if (signal.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("voice:signal", { to: from, signal: pc.localDescription });
      } else if (signal.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
      } else if (signal.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal));
        } catch {
          /* ignora candidatos fora de ordem */
        }
      }
    }

    function onScreenStart({ socketId, username }) {
      setRemoteScreens((prev) => ({ ...prev, [socketId]: username }));
      playStreamSound();
    }

    function onScreenStop({ socketId }) {
      setRemoteScreens((prev) => {
        const next = { ...prev };
        delete next[socketId];
        return next;
      });
      delete pendingScreenStreams.current[socketId];
      setExpandedTile((cur) => (cur === socketId ? null : cur));
    }

    // O dono da call te expulsou — sai igual clicar em "Sair", com um aviso.
    function onKicked({ channelId: kickedChannelId }) {
      if (kickedChannelId !== channel?.id) return;
      leave();
      setError("Você foi removido da call pelo dono do servidor.");
    }

    socket.on("voice:room-users", onRoomUsers);
    socket.on("voice:user-joined", onUserJoined);
    socket.on("voice:user-left", onUserLeft);
    socket.on("voice:signal", onSignal);
    socket.on("screenshare:start", onScreenStart);
    socket.on("screenshare:stop", onScreenStop);
    socket.on("voice:kicked", onKicked);

    return () => {
      socket.off("voice:room-users", onRoomUsers);
      socket.off("voice:user-joined", onUserJoined);
      socket.off("voice:user-left", onUserLeft);
      socket.off("voice:signal", onSignal);
      socket.off("screenshare:start", onScreenStart);
      socket.off("screenshare:stop", onScreenStop);
      socket.off("voice:kicked", onKicked);
      leave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel?.id]);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") {
        setExpandedTile(null);
        setCtxMenu(null);
      }
    }
    function onClickAway() {
      setCtxMenu(null);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("click", onClickAway);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("click", onClickAway);
    };
  }, []);

  function openCtxMenu(e, id, username) {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ id, username, x: e.clientX, y: e.clientY });
  }

  function setPeerVolume(username, volume) {
    setPeerAudioPrefs((prev) => ({ ...prev, [username]: { ...prev[username], volume } }));
    if (ctxMenu) {
      const audio = audioElsRef.current[ctxMenu.id];
      if (audio) audio.volume = volume / 100;
    }
  }

  function togglePeerMute(username) {
    setPeerAudioPrefs((prev) => {
      const nextMuted = !prev[username]?.muted;
      if (ctxMenu) {
        const audio = audioElsRef.current[ctxMenu.id];
        if (audio) audio.muted = nextMuted;
      }
      return { ...prev, [username]: { ...prev[username], muted: nextMuted } };
    });
  }

  async function join() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
    } catch {
      setError("Não foi possível acessar o microfone. Verifique as permissões do navegador.");
      return;
    }

    getSocket().emit("voice:join", channel.id);
    connectedRef.current = true;
    setConnected(true);
    playJoinSound();
  }

  async function startScreenShare() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      const track = stream.getVideoTracks()[0];

      // Adiciona a faixa de vídeo em cada conexão já aberta
      Object.entries(peersRef.current).forEach(([socketId, pc]) => {
        const sender = pc.addTrack(track, stream);
        screenSendersRef.current[socketId] = sender;
        renegotiate(socketId, pc);
      });

      track.onended = stopScreenShare;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      getSocket().emit("screenshare:start", channel.id);
      setSharingScreen(true);
      playStreamSound();
    } catch {
      setError("Não foi possível iniciar o compartilhamento de tela.");
    }
  }

  function stopScreenShare() {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    Object.entries(peersRef.current).forEach(([socketId, pc]) => {
      const sender = screenSendersRef.current[socketId];
      if (sender) {
        pc.removeTrack(sender);
        renegotiate(socketId, pc);
      }
    });
    screenSendersRef.current = {};
    screenStreamRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (connectedRef.current) getSocket().emit("screenshare:stop", channel.id);
    setSharingScreen(false);
    setExpandedTile((cur) => (cur === "local" ? null : cur));
  }

  async function renegotiate(socketId, pc) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    getSocket().emit("voice:signal", { to: socketId, signal: pc.localDescription });
  }

  function createPeerConnection(socketId, username) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peersRef.current[socketId] = pc;

    localStreamRef.current.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current);
    });

    if (screenStreamRef.current) {
      const screenTrack = screenStreamRef.current.getVideoTracks()[0];
      if (screenTrack) {
        screenSendersRef.current[socketId] = pc.addTrack(screenTrack, screenStreamRef.current);
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        getSocket().emit("voice:signal", { to: socketId, signal: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      if (e.track.kind === "video") {
        // Faixa de vídeo = compartilhamento de tela de alguém
        const videoEl = remoteVideoRefs.current[socketId];
        if (videoEl) videoEl.srcObject = e.streams[0];
        else pendingScreenStreams.current[socketId] = e.streams[0];
        e.track.onended = () => {
          setRemoteScreens((prev) => {
            const next = { ...prev };
            delete next[socketId];
            return next;
          });
        };
        return;
      }
      let audio = audioElsRef.current[socketId];
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audioElsRef.current[socketId] = audio;
      }
      audio.srcObject = e.streams[0];
      applyAudioPrefs(socketId, usernameForSocketRef.current[socketId] || username);
    };

    return pc;
  }

  async function createPeer(socketId, isInitiator, username) {
    const pc = createPeerConnection(socketId, username);
    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      getSocket().emit("voice:signal", { to: socketId, signal: pc.localDescription });
    }
  }

  function leave() {
    const socket = getSocket();
    const wasConnected = connectedRef.current;
    if (sharingScreen) stopScreenShare();
    if (socket && channel) socket.emit("voice:leave", channel.id);
    Object.values(peersRef.current).forEach((pc) => pc.close());
    peersRef.current = {};
    Object.values(audioElsRef.current).forEach((a) => (a.srcObject = null));
    audioElsRef.current = {};
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    connectedRef.current = false;
    setConnected(false);
    setParticipants([]);
    setRemoteScreens({});
    setExpandedTile(null);
    setCtxMenu(null);
    remoteVideoRefs.current = {};
    pendingScreenStreams.current = {};
    if (wasConnected) playLeaveSound();
  }

  function toggleMute() {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getAudioTracks().forEach((t) => (t.enabled = muted));
    setMuted(!muted);
  }

  function kickParticipant(id, username) {
    if (!confirm(`Remover ${username} da call?`)) return;
    getSocket().emit("voice:kick", { channelId: channel.id, targetSocketId: id });
  }

  // Retângulo de participante: usado tanto na grade normal quanto na tira do modo teatro.
  function renderTile({ id, username, isMe = false, small = false, avatarColor, avatarUrl }) {
    const sharing = isMe ? sharingScreen : !!remoteScreens[id];
    const isMuted = isMe && muted;
    const bg = isMe ? currentUser.avatar_color : avatarColor || colorForName(username || "?");
    const imgUrl = isMe ? currentUser.avatar_url : avatarUrl;
    const canKick = isOwner && !isMe && !small && !id.startsWith("bot:");
    const localPrefs = !isMe ? peerAudioPrefs[username] : null;
    const locallyMuted = !!localPrefs?.muted;

    return (
      <div
        key={id}
        className={`voice-tile ${small ? "small" : ""} ${isMe ? "me" : ""}`}
        style={{ background: bg }}
        onContextMenu={!isMe ? (e) => openCtxMenu(e, id, username) : undefined}
      >
        {sharing && !small && (
          <button
            type="button"
            className="voice-tile-expand-btn"
            title="Expandir"
            onClick={() => setExpandedTile(id)}
          >
            ⤢
          </button>
        )}
        {canKick && (
          <button
            type="button"
            className="voice-tile-kick-btn"
            title={`Remover ${username} da call`}
            onClick={() => kickParticipant(id, username)}
          >
            ✕
          </button>
        )}
        {sharing && <span className="voice-tile-live-badge">AO VIVO</span>}
        <div className="voice-tile-avatar-wrap">
          {imgUrl ? (
            <img className="voice-tile-avatar voice-tile-avatar--img" src={imgUrl} alt={username} />
          ) : (
            <div className="voice-tile-avatar">{(username || "?").slice(0, 2).toUpperCase()}</div>
          )}
        </div>
        <div className="voice-tile-footer">
          {isMuted && <IconMicOff size={12} />}
          {locallyMuted && <span title="Mutado só pra você"><IconHeadphones size={12} /></span>}
          <span className="voice-tile-name">
            {username}
            {isMe ? " (você)" : ""}
          </span>
        </div>
      </div>
    );
  }

  const expandedIsLocal = expandedTile === "local";
  const expandedLabel = expandedIsLocal
    ? "Sua tela"
    : expandedTile
    ? `Tela de ${remoteScreens[expandedTile] || ""}`
    : "";

  return (
    <div className="voice-panel" style={hidden ? { display: "none" } : undefined}>
      <div className="voice-panel-header">🔊 {channel.name}</div>

      {!connected ? (
        <div className="voice-join-box">
          <p>Entre no canal de voz para conversar com quem estiver aqui.</p>
          {error && <div className="auth-error">{error}</div>}
          <button className="btn-primary" onClick={join}>Entrar no canal de voz</button>
        </div>
      ) : (
        <div className="voice-stage-wrap">
          {error && <div className="auth-error voice-stage-error">{error}</div>}

          <div className={`voice-stage ${expandedTile ? "theater" : ""}`}>
            {expandedTile ? (
              <>
                <div className="voice-theater-main">
                  {expandedIsLocal ? (
                    <video
                      autoPlay
                      muted
                      playsInline
                      ref={(el) => {
                        localVideoRef.current = el;
                        if (el && screenStreamRef.current) el.srcObject = screenStreamRef.current;
                      }}
                    />
                  ) : (
                    <video
                      autoPlay
                      playsInline
                      ref={(el) => {
                        if (el) {
                          remoteVideoRefs.current[expandedTile] = el;
                          const pending = pendingScreenStreams.current[expandedTile];
                          if (pending) {
                            el.srcObject = pending;
                            delete pendingScreenStreams.current[expandedTile];
                          }
                        } else {
                          const prevEl = remoteVideoRefs.current[expandedTile];
                          if (prevEl && prevEl.srcObject) {
                            pendingScreenStreams.current[expandedTile] = prevEl.srcObject;
                          }
                          delete remoteVideoRefs.current[expandedTile];
                        }
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className="voice-collapse-btn"
                    title="Recolher"
                    onClick={() => setExpandedTile(null)}
                  >
                    ⤡
                  </button>
                  <span className="voice-theater-label">{expandedLabel}</span>
                </div>

                <div className="voice-theater-strip">
                  {renderTile({ id: "local", username: currentUser.username, isMe: true, small: true })}
                  {participants.map((p) =>
                    renderTile({
                      id: p.id,
                      username: p.username,
                      avatarColor: p.avatarColor,
                      avatarUrl: p.avatarUrl,
                      small: true,
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="voice-tiles-grid">
                {renderTile({ id: "local", username: currentUser.username, isMe: true })}
                {participants.map((p) =>
                  renderTile({ id: p.id, username: p.username, avatarColor: p.avatarColor, avatarUrl: p.avatarUrl })
                )}
              </div>
            )}
          </div>

          <div className="voice-bottom-bar">
            <button
              type="button"
              className={`voice-bottom-btn ${sharingScreen ? "active" : ""}`}
              title={sharingScreen ? "Parar de compartilhar" : "Compartilhar tela"}
              onClick={sharingScreen ? stopScreenShare : startScreenShare}
            >
              <IconShareScreen />
            </button>
            <button type="button" className="voice-bottom-btn disabled" title="Câmera (em breve)" disabled>
              <IconVideo />
            </button>
            <button
              type="button"
              className={`voice-bottom-btn ${muted ? "muted" : ""}`}
              title={muted ? "Ativar microfone" : "Mutar"}
              onClick={toggleMute}
            >
              {muted ? <IconMicOff /> : <IconMic />}
            </button>
            <button type="button" className="voice-bottom-btn disabled" title="Áudio (em breve)" disabled>
              <IconHeadphones />
            </button>
            <button type="button" className="voice-bottom-btn disabled" title="Configurações (em breve)" disabled>
              <IconSettings />
            </button>
            <button type="button" className="voice-disconnect-btn" title="Desconectar" onClick={leave}>
              <IconPhoneOff size={16} />
              Desconectar
            </button>
          </div>
        </div>
      )}

      {ctxMenu && (
        <div
          className="voice-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="voice-ctx-menu-title">{ctxMenu.username}</div>

          <button type="button" className="voice-ctx-menu-item" onClick={() => togglePeerMute(ctxMenu.username)}>
            {peerAudioPrefs[ctxMenu.username]?.muted ? (
              <>
                <IconMic size={14} /> Desmutar (só pra você)
              </>
            ) : (
              <>
                <IconMicOff size={14} /> Mutar (só pra você)
              </>
            )}
          </button>

          <div className="voice-ctx-menu-volume">
            <span>Volume</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={peerAudioPrefs[ctxMenu.username]?.volume ?? 100}
              onChange={(e) => setPeerVolume(ctxMenu.username, Number(e.target.value))}
            />
            <span className="voice-ctx-menu-volume-pct">
              {peerAudioPrefs[ctxMenu.username]?.volume ?? 100}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
