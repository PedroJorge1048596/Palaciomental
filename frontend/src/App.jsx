import { useEffect, useRef, useState } from "react";
import Auth from "./components/Auth.jsx";
import ServerSidebar from "./components/ServerSidebar.jsx";
import ChannelSidebar from "./components/ChannelSidebar.jsx";
import ChatArea from "./components/ChatArea.jsx";
import MemberList from "./components/MemberList.jsx";
import VoiceChannel from "./components/VoiceChannel.jsx";
import DirectMessages from "./components/DirectMessages.jsx";
import ProfileModal from "./components/ProfileModal.jsx";
import { api } from "./api";
import { connectSocket } from "./socket";

export default function App() {
  const [auth, setAuth] = useState(() => {
    const saved = localStorage.getItem("agora-auth");
    return saved ? JSON.parse(saved) : null;
  });

  // Enquanto isso for true, não renderizamos nem a tela de login nem o app —
  // evita o "flash" da tela de app (ex: "você não tem servidores") antes de
  // sabermos se o token salvo ainda é válido.
  const [checkingAuth, setCheckingAuth] = useState(() => !!localStorage.getItem("agora-auth"));

  const [theme, setTheme] = useState(() => localStorage.getItem("agora-theme") || "default");

  const [servers, setServers] = useState([]);
  const [activeServer, setActiveServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [activeChannel, setActiveChannel] = useState(null);
  const [members, setMembers] = useState([]);
  const [viewingDms, setViewingDms] = useState(false);
  const [profileUserId, setProfileUserId] = useState(null);

  // Canal de voz "ativo" para fins de conexão — só muda quando o usuário navega
  // para um canal de voz. Ao contrário de activeChannel, NÃO some quando o usuário
  // volta a olhar um canal de texto, então o componente VoiceChannel continua montado
  // (só fica escondido via CSS) e a call/WebRTC não é derrubada.
  const [voiceChannel, setVoiceChannel] = useState(null);

  // Quem está em cada canal de voz agora, em TODOS os servidores: { channelId: [{socketId, username, sharing}] }
  // É mantido aqui (não dentro de VoiceChannel) para a barra lateral poder mostrar
  // isso mesmo quando você não está olhando/dentro daquele canal de voz.
  const [voicePresence, setVoicePresence] = useState({});

  // Espelha activeServer?.id sem sofrer de closure desatualizada dentro do
  // listener de socket registrado uma única vez logo abaixo.
  const activeServerIdRef = useRef(null);
  useEffect(() => {
    activeServerIdRef.current = activeServer?.id ?? null;
  }, [activeServer]);

  // Aplica o tema escolhido na tag <html> (é onde as variáveis de cor do CSS
  // são resolvidas) e lembra a escolha entre visitas.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("agora-theme", theme);
  }, [theme]);

  function cycleTheme() {
    setTheme((prev) => (prev === "default" ? "dark" : prev === "dark" ? "light" : "default"));
  }

  // Corrige o caso em que o token salvo no navegador continua "assinado
  // corretamente" (então passaria pelo requireAuth do backend) mas o usuário
  // dele já não existe mais no banco — ex: o Render reiniciou o serviço e o
  // banco (sem disco persistente) voltou vazio. Sem essa checagem, a pessoa
  // não caía na tela de login: caía direto na tela de "nenhum servidor",
  // porque a lista de servidores dela simplesmente vinha vazia.
  useEffect(() => {
    let cancelled = false;
    if (!auth) {
      setCheckingAuth(false);
      return;
    }
    api
      .getMe(auth.token)
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem("agora-auth");
          setAuth(null);
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingAuth(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Conecta o socket assim que autenticado — só depois que a sessão foi
  // confirmada válida contra o backend (checkingAuth === false), senão
  // chegaríamos a conectar com um token que já sabemos estar morto.
  useEffect(() => {
    if (!auth || checkingAuth) return;
    const socket = connectSocket(auth.token);
    loadServers();

    function handlePresence({ channelId, users }) {
      setVoicePresence((prev) => ({ ...prev, [channelId]: users }));
    }
    socket.on("voice:presence", handlePresence);
    socket.emit("voice:presence:request");

    // O dono removeu a gente do servidor — some com ele da lista, e se
    // estávamos olhando ele agora, volta pra tela de "nenhum servidor"
    // (isso também desmonta o VoiceChannel, se estivermos numa call dele,
    // o que já dispara o "voice:leave" sozinho).
    function handleServerRemoved({ serverId }) {
      setServers((prev) => prev.filter((s) => s.id !== serverId));
      if (activeServerIdRef.current === serverId) {
        setActiveServer(null);
        setActiveChannel(null);
        setChannels([]);
        setMembers([]);
        setVoiceChannel(null);
      }
    }
    socket.on("server:removed", handleServerRemoved);

    return () => {
      socket.off("voice:presence", handlePresence);
      socket.off("server:removed", handleServerRemoved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token, checkingAuth]);

  // Mantém voiceChannel em sincronia sempre que o usuário navega para um canal de voz.
  // Não é limpo quando ele volta para um canal de texto — é isso que mantém a call viva.
  useEffect(() => {
    if (activeChannel?.type === "voice") setVoiceChannel(activeChannel);
  }, [activeChannel]);

  function handleAuth(data) {
    localStorage.setItem("agora-auth", JSON.stringify(data));
    setAuth(data);
  }

  function logout() {
    localStorage.removeItem("agora-auth");
    setAuth(null);
    setServers([]);
    setActiveServer(null);
    setChannels([]);
    setActiveChannel(null);
    setMembers([]);
    setViewingDms(false);
    setVoiceChannel(null);
  }

  async function loadServers() {
    const list = await api.getServers(auth.token);
    setServers(list);
    if (list.length && !activeServer) selectServer(list[0]);
  }

  async function selectServer(server) {
    setViewingDms(false);
    setActiveServer(server);
    setActiveChannel(null);
    if (server.id !== activeServer?.id) setVoiceChannel(null);
    const [chs, mems] = await Promise.all([
      api.getChannels(auth.token, server.id),
      api.getMembers(auth.token, server.id),
    ]);
    setChannels(chs);
    setMembers(mems);
    const firstText = chs.find((c) => c.type === "text");
    if (firstText) setActiveChannel(firstText);
  }

  async function createServer(name) {
    const server = await api.createServer(auth.token, name);
    await loadServers();
    selectServer(server);
  }

  async function joinServer(code) {
    const server = await api.joinServer(auth.token, code);
    await loadServers();
    selectServer(server);
  }

  async function createChannel(name, type) {
    await api.createChannel(auth.token, activeServer.id, name, type);
    const chs = await api.getChannels(auth.token, activeServer.id);
    setChannels(chs);
  }

  async function changeRole(userId, role) {
    await api.setRole(auth.token, activeServer.id, userId, role);
    const mems = await api.getMembers(auth.token, activeServer.id);
    setMembers(mems);
  }

  async function removeMember(userId) {
    await api.removeMember(auth.token, activeServer.id, userId);
    const mems = await api.getMembers(auth.token, activeServer.id);
    setMembers(mems);
  }

  function openProfile(userId) {
    setProfileUserId(userId);
  }

  async function updateServerIcon(iconUrl) {
    const updated = await api.updateServer(auth.token, activeServer.id, { icon_url: iconUrl });
    setActiveServer(updated);
    setServers((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  function handleProfileUpdated(updated) {
    if (updated.id !== currentUser.id) return; // só nos importa quando é o próprio usuário
    const nextUser = { ...auth.user, ...updated };
    const nextAuth = { ...auth, user: nextUser };
    localStorage.setItem("agora-auth", JSON.stringify(nextAuth));
    setAuth(nextAuth);
    setMembers((prev) => prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m)));
  }

  if (checkingAuth) return <div className="loading-screen">Carregando…</div>;
  if (!auth) return <Auth onAuth={handleAuth} />;

  const currentUser = auth.user;
  const myMembership = members.find((m) => m.id === currentUser.id);
  const canManage = myMembership && (myMembership.role === "owner" || myMembership.role === "admin");
  const isOwner = activeServer && activeServer.owner_id === currentUser.id;

  return (
    <div className={`app-shell ${viewingDms ? "no-members" : ""}`}>
      <ServerSidebar
        servers={servers}
        activeServer={viewingDms ? null : activeServer}
        viewingDms={viewingDms}
        onSelect={selectServer}
        onCreate={createServer}
        onJoin={joinServer}
        onOpenDms={() => setViewingDms(true)}
        onLogout={logout}
        theme={theme}
        onCycleTheme={cycleTheme}
      />

      {viewingDms ? (
        <DirectMessages token={auth.token} currentUser={currentUser} onOpenProfile={openProfile} />
      ) : activeServer ? (
        <>
          <ChannelSidebar
            server={activeServer}
            channels={channels}
            activeChannel={activeChannel}
            onSelect={setActiveChannel}
            onCreateChannel={createChannel}
            canManage={canManage}
            currentUser={currentUser}
            voicePresence={voicePresence}
            token={auth.token}
            isOwner={isOwner}
            onOpenProfile={openProfile}
            onUpdateServerIcon={updateServerIcon}
          />

          {/* VoiceChannel fica montado mesmo quando o usuário está olhando um canal de
              texto (só escondido via CSS) — assim entrar numa call e clicar no #geral
              não derruba a conexão de voz/WebRTC. Só desmonta de fato se o usuário
              trocar para outro canal de voz ou sair do servidor. */}
          {voiceChannel && (
            <VoiceChannel
              key={voiceChannel.id}
              channel={voiceChannel}
              currentUser={currentUser}
              hidden={activeChannel?.type !== "voice"}
              isOwner={isOwner}
            />
          )}
          {activeChannel?.type !== "voice" && (
            <ChatArea
              key={activeChannel?.id}
              mode="channel"
              target={activeChannel}
              token={auth.token}
              currentUser={currentUser}
              onOpenProfile={openProfile}
              canManage={canManage}
            />
          )}

          <MemberList
            members={members}
            isOwner={isOwner}
            onChangeRole={changeRole}
            onOpenProfile={openProfile}
            onRemoveMember={removeMember}
          />
        </>
      ) : (
        <div className="no-server-screen">
          <p>Você ainda não tem nenhum servidor.</p>
          <p>Crie um novo ou entre com um código de convite no menu à esquerda.</p>
        </div>
      )}

      {profileUserId && (
        <ProfileModal
          token={auth.token}
          userId={profileUserId}
          currentUser={currentUser}
          onClose={() => setProfileUserId(null)}
          onUpdated={handleProfileUpdated}
        />
      )}
    </div>
  );
}
