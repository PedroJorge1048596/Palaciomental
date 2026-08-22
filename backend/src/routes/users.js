import { Router } from "express";
import db from "../db.js";
import { requireAuth } from "../auth.js";

const router = Router();
router.use(requireAuth);

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    avatar_color: row.avatar_color,
    avatar_url: row.avatar_url,
    banner_url: row.banner_url,
    bio: row.bio,
  };
}

// Perfil do usuário logado
router.get("/me", (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!row) return res.status(404).json({ error: "Usuário não encontrado" });
  res.json(publicUser(row));
});

// Atualiza avatar, imagem de fundo (banner) e/ou bio do usuário logado
router.patch("/me", (req, res) => {
  const { avatar_url, banner_url, bio } = req.body;

  if (bio !== undefined && typeof bio === "string" && bio.length > 190) {
    return res.status(400).json({ error: "Bio muito longa (máx. 190 caracteres)" });
  }

  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!current) return res.status(404).json({ error: "Usuário não encontrado" });

  const next = {
    avatar_url: avatar_url !== undefined ? avatar_url : current.avatar_url,
    banner_url: banner_url !== undefined ? banner_url : current.banner_url,
    bio: bio !== undefined ? bio : current.bio,
  };

  db.prepare(
    "UPDATE users SET avatar_url = ?, banner_url = ?, bio = ? WHERE id = ?"
  ).run(next.avatar_url, next.banner_url, next.bio, req.user.id);

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json(publicUser(row));
});

// Perfil público de outro usuário — só visível para quem compartilha algum servidor com ele
router.get("/:userId", (req, res) => {
  if (req.params.userId === req.user.id) {
    const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!row) return res.status(404).json({ error: "Usuário não encontrado" });
    return res.json(publicUser(row));
  }

  const shared = db
    .prepare(
      `SELECT 1 FROM server_members m1
       JOIN server_members m2 ON m1.server_id = m2.server_id
       WHERE m1.user_id = ? AND m2.user_id = ? LIMIT 1`
    )
    .get(req.user.id, req.params.userId);
  if (!shared) return res.status(403).json({ error: "Vocês não compartilham nenhum servidor" });

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.userId);
  if (!row) return res.status(404).json({ error: "Usuário não encontrado" });
  res.json(publicUser(row));
});

export default router;
