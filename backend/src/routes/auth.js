import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuid } from "uuid";
import db from "../db.js";
import { signToken } from "../auth.js";

const router = Router();

const AVATAR_COLORS = [
  "#E5533D", "#3D8DE5", "#5DBE7A", "#C9A227",
  "#8B5CF6", "#EC7FA9", "#2FB6A8", "#E58A3D",
];

router.post("/register", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({
      error: "Usuário precisa de 3+ caracteres e senha de 4+ caracteres",
    });
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) return res.status(409).json({ error: "Nome de usuário já existe" });

  const id = uuid();
  const password_hash = bcrypt.hashSync(password, 10);
  const avatar_color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

  db.prepare(
    "INSERT INTO users (id, username, password_hash, avatar_color) VALUES (?, ?, ?, ?)"
  ).run(id, username, password_hash, avatar_color);

  const user = { id, username, avatar_color, avatar_url: null, banner_url: null, bio: null };
  res.json({ user, token: signToken(user) });
});

router.post("/login", (req, res) => {
  const { username, password } = req.body;
  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Usuário ou senha inválidos" });
  }
  const user = {
    id: row.id,
    username: row.username,
    avatar_color: row.avatar_color,
    avatar_url: row.avatar_url,
    banner_url: row.banner_url,
    bio: row.bio,
  };
  res.json({ user, token: signToken(user) });
});

export default router;
