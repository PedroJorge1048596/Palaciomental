import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();
router.use(requireAuth);

export function pairKey(a, b) {
  return [a, b].sort().join(":");
}

// Lista pessoas com quem o usuário compartilha algum servidor (contatos possíveis para DM)
router.get("/contacts", (req, res) => {
  const contacts = db
    .prepare(
      `SELECT DISTINCT u.id, u.username, u.avatar_color, u.avatar_url
       FROM server_members m1
       JOIN server_members m2 ON m1.server_id = m2.server_id AND m2.user_id != m1.user_id
       JOIN users u ON u.id = m2.user_id
       WHERE m1.user_id = ?
       ORDER BY u.username`
    )
    .all(req.user.id);
  res.json(contacts);
});

// Histórico de mensagens diretas com outro usuário
router.get("/:otherUserId/messages", (req, res) => {
  const key = pairKey(req.user.id, req.params.otherUserId);
  const messages = db
    .prepare(
      `SELECT dm.id, dm.content, dm.attachment_url, dm.created_at, dm.from_user_id,
              u.username, u.avatar_color, u.avatar_url
       FROM dm_messages dm JOIN users u ON u.id = dm.from_user_id
       WHERE dm.pair_key = ? ORDER BY dm.created_at ASC LIMIT 200`
    )
    .all(key);
  res.json(messages);
});

export default router;
