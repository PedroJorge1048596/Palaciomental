// Bot de música: entra no canal de voz como se fosse "mais um participante" do
// mesh WebRTC (igual todo mundo faz em VoiceChannel.jsx), só que do lado do
// servidor. Ele nunca passa por um socket.io de verdade — o server.js só
// intercepta os eventos de voz endereçados a ele (voice:signal com
// to = "bot:<channelId>") e repassa pra cá.
//
// Fluxo de áudio: yt-dlp baixa o melhor áudio do YouTube direto pro stdout →
// ffmpeg decodifica pra PCM cru (16 bits, 48kHz, mono) → a gente lê esse PCM
// em pedaços de 10ms e empurra pro RTCAudioSource do wrtc, que se encarrega
// de codificar em Opus e mandar pra CADA conexão WebRTC aberta com os
// participantes reais da call.

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ffmpegPath from "ffmpeg-static";
import wrtc from "@roamhq/wrtc";
import { v4 as uuid } from "uuid";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Caminho do binário do yt-dlp baixado pelo postinstall (scripts/install-ytdlp.js).
// Se por algum motivo ele não existir (download falhou no build), cai pra
// esperar um "yt-dlp" disponível no PATH do sistema.
function ytDlpBinPath() {
  const isWin = process.platform === "win32";
  const local = path.join(__dirname, "..", "bin", isWin ? "yt-dlp.exe" : "yt-dlp");
  return fs.existsSync(local) ? local : "yt-dlp";
}

const { RTCPeerConnection, MediaStream, nonstandard } = wrtc;
const { RTCAudioSource } = nonstandard;

const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

export const BOT_USER_ID = "music-bot";
export const BOT_USERNAME = "🎵 Music Bot";
const BOT_AVATAR_COLOR = "#1DB954";

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME_MS = 10;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000; // 480
const BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2 * CHANNELS; // PCM 16 bits
const SILENT_FRAMES_BEFORE_NEXT = 25; // ~250ms de buffer vazio = música realmente acabou

const YOUTUBE_URL_RE =
  /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)[\w-]+/i;

// voiceChannelId -> BotSession
const sessions = new Map();

function botSocketId(voiceChannelId) {
  return `bot:${voiceChannelId}`;
}

export function isBotSocketId(id) {
  return typeof id === "string" && id.startsWith("bot:");
}

function postBotMessage(io, textChannelId, content) {
  const id = uuid();
  db.prepare(
    "INSERT INTO messages (id, channel_id, user_id, content, attachment_url) VALUES (?, ?, ?, ?, NULL)"
  ).run(id, textChannelId, BOT_USER_ID, content);

  const row = db
    .prepare(
      `SELECT m.id, m.content, m.attachment_url, m.created_at, u.id as user_id, u.username, u.avatar_color, u.avatar_url
       FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`
    )
    .get(id);

  io.to(`channel:${textChannelId}`).emit("message:new", row);
}

class BotSession {
  constructor(io, textChannelId, voiceChannelId) {
    this.io = io;
    this.textChannelId = textChannelId;
    this.voiceChannelId = voiceChannelId;
    this.queue = [];
    this.current = null;
    this.peers = new Map(); // socketId (humano) -> RTCPeerConnection
    this.audioSource = new RTCAudioSource();
    this.ytdlpProc = null;
    this.ffmpegProc = null;
    this.frameTimer = null;
    this.pcmBuffer = Buffer.alloc(0);
    this.stopped = false;
  }

  // Cria uma faixa nova a partir do RTCAudioSource, já embrulhada num
  // MediaStream. Sem isso, `pc.addTrack(track)` manda a faixa "solta" — o
  // navegador recebe o áudio mas `event.streams` chega vazio no ontrack do
  // VoiceChannel.jsx, e `audio.srcObject = e.streams[0]` vira undefined:
  // a conexão fecha certinha, mas nenhum som sai (esse era o bot "calado").
  newAudioTrack() {
    const track = this.audioSource.createTrack();
    const stream = new MediaStream();
    stream.addTrack(track);
    return { track, stream };
  }

  get socketId() {
    return botSocketId(this.voiceChannelId);
  }

  announcePresence() {
    this.io.to(`voice:${this.voiceChannelId}`).emit("voice:user-joined", {
      socketId: this.socketId,
      username: BOT_USERNAME,
      avatarColor: BOT_AVATAR_COLOR,
      avatarUrl: null,
    });
  }

  announceLeave() {
    this.io.to(`voice:${this.voiceChannelId}`).emit("voice:user-left", { socketId: this.socketId });
  }

  // O bot sempre inicia a conexão com um humano (equivalente ao que o
  // VoiceChannel.jsx faz em onRoomUsers/createPeer, só que do outro lado).
  async connectToPeer(humanSocketId) {
    if (this.peers.has(humanSocketId)) return;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(humanSocketId, pc);
    const { track, stream } = this.newAudioTrack();
    pc.addTrack(track, stream);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.io.to(humanSocketId).emit("voice:signal", {
          from: this.socketId,
          signal: e.candidate,
          user: { username: BOT_USERNAME },
        });
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.io.to(humanSocketId).emit("voice:signal", {
        from: this.socketId,
        signal: pc.localDescription,
        user: { username: BOT_USERNAME },
      });
    } catch (err) {
      console.error("[musicBot] falha ao conectar com peer", humanSocketId, err);
    }
  }

  async handleSignal(humanSocketId, signal) {
    let pc = this.peers.get(humanSocketId);
    if (!pc) {
      pc = new RTCPeerConnection(ICE_SERVERS);
      this.peers.set(humanSocketId, pc);
      const { track, stream } = this.newAudioTrack();
      pc.addTrack(track, stream);
      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this.io.to(humanSocketId).emit("voice:signal", {
            from: this.socketId,
            signal: e.candidate,
            user: { username: BOT_USERNAME },
          });
        }
      };
    }
    try {
      if (signal.type === "answer") {
        await pc.setRemoteDescription(signal);
      } else if (signal.type === "offer") {
        await pc.setRemoteDescription(signal);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.io.to(humanSocketId).emit("voice:signal", {
          from: this.socketId,
          signal: pc.localDescription,
          user: { username: BOT_USERNAME },
        });
      } else if (signal.candidate) {
        await pc.addIceCandidate(signal).catch(() => {});
      }
    } catch (err) {
      console.error("[musicBot] erro de sinalização", err);
    }
  }

  disconnectPeer(humanSocketId) {
    const pc = this.peers.get(humanSocketId);
    if (pc) {
      pc.close();
      this.peers.delete(humanSocketId);
    }
  }

  enqueue(url, title, requestedBy) {
    this.queue.push({ url, title, requestedBy });
  }

  async playNext() {
    this.killAudioProcesses();

    if (this.queue.length === 0) {
      this.current = null;
      postBotMessage(this.io, this.textChannelId, "⏹️ Fila vazia — saindo da call.");
      this.stop();
      return;
    }

    this.current = this.queue.shift();
    postBotMessage(
      this.io,
      this.textChannelId,
      `🎵 Tocando agora: **${this.current.title}** (pedido por ${this.current.requestedBy})`
    );

    try {
      this.startAudioPipeline(this.current.url);
    } catch (err) {
      console.error("[musicBot] falha ao iniciar áudio", err);
      postBotMessage(this.io, this.textChannelId, "⚠️ Não consegui reproduzir esse link, pulando.");
      this.playNext();
    }
  }

  startAudioPipeline(url) {
    // yt-dlp escreve o melhor áudio disponível direto no stdout (sem salvar em disco).
    // "--extractor-args youtube:player_client=android" evita boa parte dos bloqueios
    // "Sign in to confirm you're not a bot" que o YouTube vem aplicando no cliente
    // padrão (web) — mas o cliente android só expõe formatos combinados (vídeo+áudio
    // juntos), não streams de áudio puro. Por isso "-f bestaudio" sozinho falha nele
    // ("Requested format is not available") — "bestaudio/best" cai pro melhor formato
    // combinado quando não existir um só de áudio; o ffmpeg ignora o vídeo sozinho.
    this.ytdlpProc = spawn(ytDlpBinPath(), [
      "-f",
      "bestaudio/best",
      "-o",
      "-",
      "--no-warnings",
      "--extractor-args",
      "youtube:player_client=android",
      url,
    ]);

    // ffmpeg decodifica esse stream (qualquer codec que o YouTube mandar) pro
    // formato cru que o RTCAudioSource espera: PCM 16-bit little-endian, mono, 48kHz
    this.ffmpegProc = spawn(ffmpegPath, [
      "-i",
      "pipe:0",
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      String(CHANNELS),
      "pipe:1",
    ]);

    this.ytdlpProc.stdout.pipe(this.ffmpegProc.stdin);

    // Antes esses erros eram descartados em silêncio — se o yt-dlp ou o ffmpeg
    // falharem (vídeo bloqueado, formato indisponível, etc.), isso aparece
    // aqui no console do backend em vez de só deixar o bot "mudo" sem pista nenhuma.
    let ytdlpErr = "";
    this.ytdlpProc.stderr?.on("data", (chunk) => {
      ytdlpErr += chunk;
    });
    let ffmpegErr = "";
    this.ffmpegProc.stderr.on("data", (chunk) => {
      ffmpegErr += chunk;
    });
    this.ytdlpProc.on("error", (err) => console.error("[musicBot] yt-dlp error", err));
    this.ffmpegProc.on("error", (err) => console.error("[musicBot] ffmpeg error", err));
    this.ytdlpProc.on("close", (code) => {
      if (code !== 0) {
        console.error(`[musicBot] yt-dlp saiu com código ${code}:\n${ytdlpErr.slice(-2000)}`);
      }
    });

    this.pcmBuffer = Buffer.alloc(0);
    this.receivedAnyAudio = false;
    this.ffmpegProc.stdout.on("data", (chunk) => {
      if (!this.receivedAnyAudio) {
        this.receivedAnyAudio = true;
        console.log(`[musicBot] recebendo áudio de "${this.current?.title}"`);
      }
      this.pcmBuffer = Buffer.concat([this.pcmBuffer, chunk]);
    });

    this.ffmpegProc.on("close", (code) => {
      if (!this.receivedAnyAudio) {
        console.error(
          `[musicBot] ffmpeg não gerou nenhum áudio (código ${code}). stderr do ffmpeg:\n${ffmpegErr.slice(-2000)}\n` +
            `stderr do yt-dlp:\n${ytdlpErr.slice(-2000)}`
        );
        postBotMessage(
          this.io,
          this.textChannelId,
          "⚠️ Não consegui obter áudio desse vídeo (veja o console do backend pra detalhes). Pulando."
        );
      }
    });

    this.startFrameTimer();
  }

  // Lê o buffer de PCM em fatias de 10ms, no ritmo certo, e empurra pro
  // RTCAudioSource — é isso que vira áudio de verdade em cada peer conectado.
  startFrameTimer() {
    if (this.frameTimer) clearInterval(this.frameTimer);
    let emptyStreak = 0;

    this.frameTimer = setInterval(() => {
      if (this.stopped) return;

      if (this.pcmBuffer.length >= BYTES_PER_FRAME) {
        const frame = this.pcmBuffer.subarray(0, BYTES_PER_FRAME);
        this.pcmBuffer = this.pcmBuffer.subarray(BYTES_PER_FRAME);
        emptyStreak = 0;

        // O RTCAudioSource do wrtc exige um Int16Array "limpo", dono sozinho do
        // seu próprio ArrayBuffer (não uma view de dentro do pcmBuffer maior) —
        // por isso copia os 960 bytes da fatia pra um array novo, em vez de só
        // criar uma view por cima do buffer acumulado.
        const samples = new Int16Array(SAMPLES_PER_FRAME);
        Buffer.from(samples.buffer).set(frame);

        this.audioSource.onData({
          samples,
          sampleRate: SAMPLE_RATE,
          bitsPerSample: 16,
          channelCount: CHANNELS,
          numberOfFrames: SAMPLES_PER_FRAME,
        });
      } else {
        emptyStreak++;
        const ffmpegDone = !this.ffmpegProc || this.ffmpegProc.exitCode !== null;
        if (ffmpegDone && emptyStreak > SILENT_FRAMES_BEFORE_NEXT) {
          clearInterval(this.frameTimer);
          this.frameTimer = null;
          this.playNext();
        }
      }
    }, FRAME_MS);
  }

  killAudioProcesses() {
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = null;
    }
    if (this.ytdlpProc) {
      this.ytdlpProc.kill("SIGKILL");
      this.ytdlpProc = null;
    }
    if (this.ffmpegProc) {
      this.ffmpegProc.kill("SIGKILL");
      this.ffmpegProc = null;
    }
    this.pcmBuffer = Buffer.alloc(0);
  }

  skip() {
    if (!this.current) return false;
    postBotMessage(this.io, this.textChannelId, `⏭️ Pulando: **${this.current.title}**`);
    this.playNext();
    return true;
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.killAudioProcesses();
    this.queue = [];
    this.current = null;
    this.peers.forEach((pc) => pc.close());
    this.peers.clear();
    this.announceLeave();
    sessions.delete(this.voiceChannelId);
  }
}

// ---------------- Helpers de busca ----------------

function findUserVoiceChannel(voiceRooms, dbConn, serverId, userId) {
  const voiceChannelIds = dbConn
    .prepare("SELECT id FROM channels WHERE server_id = ? AND type = 'voice'")
    .all(serverId)
    .map((c) => c.id);
  for (const channelId of voiceChannelIds) {
    const room = voiceRooms[channelId] || [];
    if (room.some((u) => u.userId === userId)) return channelId;
  }
  return null;
}

function findSessionByTextChannel(textChannelId) {
  for (const session of sessions.values()) {
    if (session.textChannelId === textChannelId) return session;
  }
  return null;
}

function findSessionForUser(voiceRooms, userId) {
  for (const session of sessions.values()) {
    const room = voiceRooms[session.voiceChannelId] || [];
    if (room.some((u) => u.userId === userId)) return session;
  }
  return null;
}

async function fetchTitle(url) {
  return new Promise((resolve) => {
    const proc = spawn(ytDlpBinPath(), ["--dump-json", "--no-warnings", "--skip-download", url]);
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk;
    });
    proc.on("error", () => resolve(url)); // binário não encontrado, etc.
    proc.on("close", () => {
      try {
        const info = JSON.parse(out);
        resolve(info?.title || url);
      } catch {
        resolve(url);
      }
    });
  });
}

// ---------------- API chamada pelo server.js ----------------

// Retorna true se a mensagem era um comando (e portanto NÃO deve ser salva
// como mensagem normal de chat).
export async function handleChatCommand({ io, db: dbConn, socket, voiceRooms, channelId, text }) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (lower.startsWith("m!p ") || lower === "m!p") {
    const url = trimmed.slice(3).trim();
    if (!YOUTUBE_URL_RE.test(url)) {
      postBotMessage(io, channelId, "⚠️ Manda um link válido do YouTube depois do `m!p`.");
      return true;
    }

    const channelRow = dbConn.prepare("SELECT server_id FROM channels WHERE id = ?").get(channelId);
    if (!channelRow) return true;

    const voiceChannelId = findUserVoiceChannel(voiceRooms, dbConn, channelRow.server_id, socket.user.id);
    if (!voiceChannelId) {
      postBotMessage(io, channelId, "⚠️ Entre em um canal de voz primeiro pra eu poder tocar música aí.");
      return true;
    }

    let session = sessions.get(voiceChannelId);
    if (!session) {
      session = new BotSession(io, channelId, voiceChannelId);
      sessions.set(voiceChannelId, session);
      session.announcePresence();
      const room = voiceRooms[voiceChannelId] || [];
      for (const u of room) {
        await session.connectToPeer(u.socketId);
      }
    }

    const title = await fetchTitle(url);
    session.enqueue(url, title, socket.user.username);
    if (!session.current) {
      await session.playNext();
    } else {
      postBotMessage(io, channelId, `➕ Adicionado à fila: **${title}**`);
    }
    return true;
  }

  if (lower === "m!s" || lower === "m!skip") {
    const session = findSessionByTextChannel(channelId) || findSessionForUser(voiceRooms, socket.user.id);
    if (!session) {
      postBotMessage(io, channelId, "⚠️ Não tem música tocando agora.");
      return true;
    }
    session.skip();
    return true;
  }

  if (lower === "m!stop") {
    const session = findSessionByTextChannel(channelId) || findSessionForUser(voiceRooms, socket.user.id);
    if (!session) {
      postBotMessage(io, channelId, "⚠️ Não estou em nenhuma call agora.");
      return true;
    }
    postBotMessage(io, channelId, "👋 Saindo da call.");
    session.stop();
    return true;
  }

  return false;
}

// ---------------- Hooks de eventos de voz (chamados pelo server.js) ----------------

export function onVoiceSignalToBot(voiceChannelId, humanSocketId, signal) {
  const session = sessions.get(voiceChannelId);
  if (session) session.handleSignal(humanSocketId, signal);
}

export function onUserJoinedVoice(voiceChannelId, humanSocketId) {
  const session = sessions.get(voiceChannelId);
  if (session) session.connectToPeer(humanSocketId);
}

export function onUserLeftVoice(voiceChannelId, humanSocketId) {
  const session = sessions.get(voiceChannelId);
  if (!session) return;
  session.disconnectPeer(humanSocketId);
}

// Se a call ficou vazia de humanos, não faz sentido o bot continuar tocando sozinho.
export function stopIfRoomEmpty(voiceChannelId, voiceRooms) {
  const session = sessions.get(voiceChannelId);
  if (!session) return;
  const room = voiceRooms[voiceChannelId] || [];
  if (room.length === 0) session.stop();
}
