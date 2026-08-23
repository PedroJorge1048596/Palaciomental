import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db.js";
import { requireAuth } from "../auth.js";
import { getIO } from "../realtime.js";

const router = Router();
router.use(requireAuth);

function genInviteCode() {
  return Math.random().toString(36).slice(2, 8);
}

// Lista os servidores do usuário logado
router.get("/", (req, res) => {
  const servers = db
    .prepare(
      `SELECT s.* FROM servers s
       JOIN server_members m ON m.server_id = s.id
       WHERE m.user_id = ?`
    )
    .all(req.user.id);
  res.json(servers);
});

// Cria um servidor novo (o criador vira "owner")
router.post("/", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Nome é obrigatório" });

  const serverId = uuid();
  const inviteCode = genInviteCode();

  db.prepare(
    "INSERT INTO servers (id, name, owner_id, invite_code) VALUES (?, ?, ?, ?)"
  ).run(serverId, name, req.user.id, inviteCode);

  db.prepare(
    "INSERT INTO server_members (server_id, user_id, role) VALUES (?, ?, 'owner')"
  ).run(serverId, req.user.id);

  // Canais padrão
  const generalId = uuid();
  db.prepare(
    "INSERT INTO channels (id, server_id, name, type, position) VALUES (?, ?, 'geral', 'text', 0)"
  ).run(generalId, serverId);
  const voiceId = uuid();
  db.prepare(
    "INSERT INTO channels (id, server_id, name, type, position) VALUES (?, ?, 'sala-de-voz', 'voice', 1)"
  ).run(voiceId, serverId);

  const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(serverId);
  res.json(server);
});

// Atualiza dados do servidor (por enquanto: ícone). Apenas o dono pode alterar.
router.patch("/:serverId", (req, res) => {
  const { icon_url } = req.body;
  const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "Servidor não encontrado" });
  if (server.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Apenas o dono do servidor pode alterar o ícone" });
  }

  db.prepare("UPDATE servers SET icon_url = ? WHERE id = ?").run(
    icon_url !== undefined ? icon_url : server.icon_url,
    req.params.serverId
  );

  const updated = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.serverId);
  res.json(updated);
});

// Entrar em um servidor via código de convite
router.post("/join", (req, res) => {
  const { inviteCode } = req.body;
  const server = db.prepare("SELECT * FROM servers WHERE invite_code = ?").get(inviteCode);
  if (!server) return res.status(404).json({ error: "Convite inválido" });

  const already = db
    .prepare("SELECT * FROM server_members WHERE server_id = ? AND user_id = ?")
    .get(server.id, req.user.id);
  if (!already) {
    db.prepare(
      "INSERT INTO server_members (server_id, user_id, role) VALUES (?, ?, 'member')"
    ).run(server.id, req.user.id);
  }
  res.json(server);
});

// Canais de um servidor
router.get("/:serverId/channels", (req, res) => {
  const member = db
    .prepare("SELECT * FROM server_members WHERE server_id = ? AND user_id = ?")
    .get(req.params.serverId, req.user.id);
  if (!member) return res.status(403).json({ error: "Você não é membro deste servidor" });

  const channels = db
    .prepare("SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC")
    .all(req.params.serverId);
  res.json(channels);
});

// Criar canal (apenas owner/admin)
router.post("/:serverId/channels", (req, res) => {
  const { name, type } = req.body;
  const member = db
    .prepare("SELECT * FROM server_members WHERE server_id = ? AND user_id = ?")
    .get(req.params.serverId, req.user.id);
  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return res.status(403).json({ error: "Sem permissão para criar canais" });
  }

  const id = uuid();
  const posRow = db
    .prepare("SELECT COALESCE(MAX(position), -1) as maxPos FROM channels WHERE server_id = ?")
    .get(req.params.serverId);
  db.prepare(
    "INSERT INTO channels (id, server_id, name, type, position) VALUES (?, ?, ?, ?, ?)"
  ).run(id, req.params.serverId, name, type === "voice" ? "voice" : "text", posRow.maxPos + 1);

  const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(id);
  res.json(channel);
});

// Membros de um servidor (com cargo)
router.get("/:serverId/members", (req, res) => {
  const member = db
    .prepare("SELECT * FROM server_members WHERE server_id = ? AND user_id = ?")
    .get(req.params.serverId, req.user.id);
  if (!member) return res.status(403).json({ error: "Você não é membro deste servidor" });

  const members = db
    .prepare(
      `SELECT u.id, u.username, u.avatar_color, u.avatar_url, m.role
       FROM server_members m JOIN users u ON u.id = m.user_id
       WHERE m.server_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.username`
    )
    .all(req.params.serverId);
  res.json(members);
});

// Alterar cargo de um membro (apenas owner)
router.patch("/:serverId/members/:userId/role", (req, res) => {
  const { role } = req.body;
  const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.serverId);
  if (!server || server.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Apenas o dono do servidor pode alterar cargos" });
  }
  if (!["admin", "member"].includes(role)) {
    return res.status(400).json({ error: "Cargo inválido" });
  }
  db.prepare(
    "UPDATE server_members SET role = ? WHERE server_id = ? AND user_id = ?"
  ).run(role, req.params.serverId, req.params.userId);
  res.json({ ok: true });
});

// Remove um membro do servidor (expulsão) — apenas o dono pode fazer isso.
router.delete("/:serverId/members/:userId", (req, res) => {
  const server = db.prepare("SELECT * FROM servers WHERE id = ?").get(req.params.serverId);
  if (!server) return res.status(404).json({ error: "Servidor não encontrado" });
  if (server.owner_id !== req.user.id) {
    return res.status(403).json({ error: "Apenas o dono do servidor pode remover membros" });
  }
  if (req.params.userId === server.owner_id) {
    return res.status(400).json({ error: "O dono não pode remover a si mesmo do servidor" });
  }

  const result = db
    .prepare("DELETE FROM server_members WHERE server_id = ? AND user_id = ?")
    .run(req.params.serverId, req.params.userId);
  if (result.changes === 0) {
    return res.status(404).json({ error: "Esse usuário não é membro deste servidor" });
  }

  // Se a pessoa removida estiver online agora, avisa em tempo real pra sumir
  // o servidor da tela dela (e derrubar a call de voz, se estiver em uma).
  const io = getIO();
  if (io) {
    for (const [, s] of io.sockets.sockets) {
      if (s.user?.id === req.params.userId) {
        s.emit("server:removed", { serverId: req.params.serverId });
      }
    }
  }

  res.json({ ok: true });
});

// Histórico de mensagens de um canal
router.get("/channels/:channelId/messages", (req, res) => {
  const channel = db.prepare("SELECT * FROM channels WHERE id = ?").get(req.params.channelId);
  if (!channel) return res.status(404).json({ error: "Canal não encontrado" });
  const member = db
    .prepare("SELECT * FROM server_members WHERE server_id = ? AND user_id = ?")
    .get(channel.server_id, req.user.id);
  if (!member) return res.status(403).json({ error: "Sem acesso a este canal" });

  const messages = db
    .prepare(
      `SELECT m.id, m.content, m.attachment_url, m.created_at, u.id as user_id, u.username, u.avatar_color, u.avatar_url
       FROM messages m JOIN users u ON u.id = m.user_id
       WHERE m.channel_id = ? ORDER BY m.created_at ASC LIMIT 200`
    )
    .all(req.params.channelId);
  res.json(messages);
});

export default router;
