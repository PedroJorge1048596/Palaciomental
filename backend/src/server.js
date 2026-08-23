import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { v4 as uuid } from "uuid";
import db from "./db.js";
import { verifySocketToken } from "./auth.js";
import authRoutes from "./routes/auth.js";
import serverRoutes from "./routes/servers.js";
import uploadRoutes from "./routes/uploads.js";
import dmRoutes, { pairKey } from "./routes/dms.js";
import userRoutes from "./routes/users.js";
import gifRoutes from "./routes/gifs.js";
import {
  handleChatCommand,
  isBotSocketId,
  onVoiceSignalToBot,
  onUserJoinedVoice,
  onUserLeftVoice,
  stopIfRoomEmpty,
} from "./musicBot.js";
import { initRealtime } from "./realtime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..");

const app = express();
app.set("trust proxy", 1); // necessário atrás de proxies como Render, pra req.protocol detectar "https" corretamente
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(dataDir, "uploads")));

app.use("/api/auth", authRoutes);
app.use("/api/servers", serverRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/dms", dmRoutes);
app.use("/api/users", userRoutes);
app.use("/api/gifs", gifRoutes);

// Serve o frontend já compilado (frontend/dist) quando ele existir — permite publicar
// backend + frontend juntos, num único serviço/URL. Rode `npm run build` dentro de
// frontend/ antes de iniciar o backend em produção para gerar essa pasta.
const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// Autentica cada conexão de socket usando o JWT enviado pelo cliente
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  const user = token ? verifySocketToken(token) : null;
  if (!user) return next(new Error("Não autenticado"));
  socket.user = user;
  next();
});

initRealtime(io);

// Quem está em qual sala de voz, por canal: { channelId: [{id, username}] }
const voiceRooms = {};

// Lista "pública" (sem dados sensíveis) de quem está num canal de voz — usada pela barra lateral
function presenceList(channelId) {
  return (voiceRooms[channelId] || []).map((u) => ({
    socketId: u.socketId,
    userId: u.userId,
    username: u.username,
    avatarColor: u.avatarColor,
    avatarUrl: u.avatarUrl,
    sharing: !!u.sharing,
  }));
}

// Avisa TODO MUNDO conectado (não só quem está na call) sobre quem está em um canal de voz,
// para a barra lateral poder mostrar isso mesmo pra quem não entrou na call
function broadcastPresence(channelId) {
  io.emit("voice:presence", { channelId, users: presenceList(channelId) });
}

io.on("connection", (socket) => {
  // Ao conectar (ou reconectar), o cliente pede um retrato de todas as calls ativas
  socket.on("voice:presence:request", () => {
    Object.keys(voiceRooms).forEach((channelId) => {
      if (voiceRooms[channelId]?.length) {
        socket.emit("voice:presence", { channelId, users: presenceList(channelId) });
      }
    });
  });

  // Entrar num canal de texto (para receber mensagens em tempo real)
  socket.on("channel:join", (channelId) => {
    socket.join(`channel:${channelId}`);
  });

  socket.on("channel:leave", (channelId) => {
    socket.leave(`channel:${channelId}`);
  });

  // Nova mensagem de texto (com anexo de imagem opcional)
  socket.on("message:send", async ({ channelId, content, attachmentUrl }) => {
    const text = (content || "").trim();
    if (!text && !attachmentUrl) return;

    // Comandos do bot de música (m!p, m!s, m!stop) nunca viram mensagem salva —
    // o bot responde no lugar com suas próprias mensagens.
    if (text.toLowerCase().startsWith("m!")) {
      const handled = await handleChatCommand({ io, db, socket, voiceRooms, channelId, text });
      if (handled) return;
    }

    const id = uuid();
    db.prepare(
      "INSERT INTO messages (id, channel_id, user_id, content, attachment_url) VALUES (?, ?, ?, ?, ?)"
    ).run(id, channelId, socket.user.id, text, attachmentUrl || null);

    const row = db
      .prepare(
        `SELECT m.id, m.content, m.attachment_url, m.created_at, u.id as user_id, u.username, u.avatar_color, u.avatar_url
         FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`
      )
      .get(id);

    io.to(`channel:${channelId}`).emit("message:new", row);
  });

  // Apagar mensagem de canal: o autor sempre pode apagar a própria mensagem;
  // dono/admin do servidor podem apagar qualquer mensagem do canal (moderação).
  socket.on("message:delete", ({ channelId, messageId }) => {
    const msg = db.prepare("SELECT * FROM messages WHERE id = ? AND channel_id = ?").get(messageId, channelId);
    if (!msg) return;
    const channel = db.prepare("SELECT server_id FROM channels WHERE id = ?").get(channelId);
    if (!channel) return;

    let canDelete = msg.user_id === socket.user.id;
    if (!canDelete) {
      const membership = db
        .prepare("SELECT role FROM server_members WHERE server_id = ? AND user_id = ?")
        .get(channel.server_id, socket.user.id);
      canDelete = !!membership && (membership.role === "owner" || membership.role === "admin");
    }
    if (!canDelete) return;

    db.prepare("DELETE FROM messages WHERE id = ?").run(messageId);
    io.to(`channel:${channelId}`).emit("message:deleted", { id: messageId, channelId });
  });

  // --- Mensagens diretas ---
  socket.on("dm:join", (otherUserId) => {
    socket.join(`dm:${pairKey(socket.user.id, otherUserId)}`);
  });

  socket.on("dm:leave", (otherUserId) => {
    socket.leave(`dm:${pairKey(socket.user.id, otherUserId)}`);
  });

  socket.on("dm:send", ({ toUserId, content, attachmentUrl }) => {
    const text = (content || "").trim();
    if (!text && !attachmentUrl) return;
    const id = uuid();
    const key = pairKey(socket.user.id, toUserId);
    db.prepare(
      `INSERT INTO dm_messages (id, pair_key, from_user_id, to_user_id, content, attachment_url)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, key, socket.user.id, toUserId, text, attachmentUrl || null);

    const row = db
      .prepare(
        `SELECT dm.id, dm.content, dm.attachment_url, dm.created_at, dm.from_user_id,
                u.username, u.avatar_color, u.avatar_url
         FROM dm_messages dm JOIN users u ON u.id = dm.from_user_id WHERE dm.id = ?`
      )
      .get(id);

    io.to(`dm:${key}`).emit("dm:new", row);
  });

  // Apagar mensagem de DM: só quem enviou pode apagar (não há moderação em DM).
  socket.on("dm:delete", ({ otherUserId, messageId }) => {
    const key = pairKey(socket.user.id, otherUserId);
    const msg = db.prepare("SELECT * FROM dm_messages WHERE id = ? AND pair_key = ?").get(messageId, key);
    if (!msg || msg.from_user_id !== socket.user.id) return;

    db.prepare("DELETE FROM dm_messages WHERE id = ?").run(messageId);
    io.to(`dm:${key}`).emit("dm:deleted", { id: messageId });
  });

  // --- Sinalização simples para canais de voz (WebRTC mesh, ideal para poucos usuários) ---
  socket.on("voice:join", (channelId) => {
    socket.join(`voice:${channelId}`);
    voiceRooms[channelId] = voiceRooms[channelId] || [];
    const already = voiceRooms[channelId].some((u) => u.socketId === socket.id);
    if (!already) {
      // Busca avatar/cor atuais no banco (em vez de confiar no JWT, que pode estar desatualizado
      // se o usuário editou o perfil depois de logar)
      const userRow = db
        .prepare("SELECT avatar_color, avatar_url FROM users WHERE id = ?")
        .get(socket.user.id);
      voiceRooms[channelId].push({
        socketId: socket.id,
        userId: socket.user.id,
        username: socket.user.username,
        avatarColor: userRow?.avatar_color || null,
        avatarUrl: userRow?.avatar_url || null,
        sharing: false,
      });
    }

    socket.data.voiceChannel = channelId;
    const me = voiceRooms[channelId].find((u) => u.socketId === socket.id);
    // Avisa aos outros que alguém entrou, e envia a lista atual (com socketId) para quem entrou
    socket.to(`voice:${channelId}`).emit("voice:user-joined", {
      socketId: socket.id,
      username: socket.user.username,
      avatarColor: me?.avatarColor,
      avatarUrl: me?.avatarUrl,
    });
    socket.emit(
      "voice:room-users",
      voiceRooms[channelId].filter((u) => u.socketId !== socket.id)
    );
    broadcastPresence(channelId);
    // Se o bot de música já estiver nessa call, ele também precisa conectar com quem acabou de entrar
    onUserJoinedVoice(channelId, socket.id);
  });

  socket.on("voice:leave", (channelId) => {
    socket.leave(`voice:${channelId}`);
    if (voiceRooms[channelId]) {
      voiceRooms[channelId] = voiceRooms[channelId].filter((u) => u.socketId !== socket.id);
    }
    socket.data.voiceChannel = null;
    socket.to(`voice:${channelId}`).emit("voice:user-left", { socketId: socket.id });
    broadcastPresence(channelId);
    onUserLeftVoice(channelId, socket.id);
    stopIfRoomEmpty(channelId, voiceRooms);
  });

  // Repassa sinalização WebRTC (offer/answer/ice) entre pares — inclui o bot de
  // música, que não é um socket.io de verdade, então intercepta e roteia pra ele.
  socket.on("voice:signal", ({ to, signal }) => {
    if (isBotSocketId(to)) {
      const voiceChannelId = to.slice(4); // remove o prefixo "bot:"
      onVoiceSignalToBot(voiceChannelId, socket.id, signal);
      return;
    }
    io.to(to).emit("voice:signal", { from: socket.id, signal, user: socket.user });
  });

  // Expulsar alguém de uma call de voz — só o dono do servidor pode.
  // A verificação de permissão é sempre feita aqui no servidor (nunca confiar
  // só no botão sumir/aparecer no frontend).
  socket.on("voice:kick", ({ channelId, targetSocketId }) => {
    const channel = db.prepare("SELECT server_id FROM channels WHERE id = ?").get(channelId);
    if (!channel) return;
    const server = db.prepare("SELECT owner_id FROM servers WHERE id = ?").get(channel.server_id);
    if (!server || server.owner_id !== socket.user.id) return;
    if (isBotSocketId(targetSocketId)) return; // pro bot, use o comando m!stop

    if (voiceRooms[channelId]) {
      voiceRooms[channelId] = voiceRooms[channelId].filter((u) => u.socketId !== targetSocketId);
    }
    io.to(`voice:${channelId}`).emit("voice:user-left", { socketId: targetSocketId });
    io.to(targetSocketId).emit("voice:kicked", { channelId });
    broadcastPresence(channelId);
    onUserLeftVoice(channelId, targetSocketId);
    stopIfRoomEmpty(channelId, voiceRooms);

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.leave(`voice:${channelId}`);
      if (targetSocket.data.voiceChannel === channelId) targetSocket.data.voiceChannel = null;
    }
  });

  // Avisa quem está transmitindo tela (o vídeo em si viaja pela mesma conexão WebRTC de voz)
  socket.on("screenshare:start", (channelId) => {
    socket.to(`voice:${channelId}`).emit("screenshare:start", { socketId: socket.id, username: socket.user.username });
    const entry = (voiceRooms[channelId] || []).find((u) => u.socketId === socket.id);
    if (entry) entry.sharing = true;
    broadcastPresence(channelId);
  });
  socket.on("screenshare:stop", (channelId) => {
    socket.to(`voice:${channelId}`).emit("screenshare:stop", { socketId: socket.id });
    const entry = (voiceRooms[channelId] || []).find((u) => u.socketId === socket.id);
    if (entry) entry.sharing = false;
    broadcastPresence(channelId);
  });

  socket.on("disconnect", () => {
    const channelId = socket.data.voiceChannel;
    if (channelId && voiceRooms[channelId]) {
      voiceRooms[channelId] = voiceRooms[channelId].filter((u) => u.socketId !== socket.id);
      socket.to(`voice:${channelId}`).emit("voice:user-left", { socketId: socket.id });
      broadcastPresence(channelId);
      onUserLeftVoice(channelId, socket.id);
      stopIfRoomEmpty(channelId, voiceRooms);
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`Backend rodando em http://localhost:${PORT}`);
});
