import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Em produção, defina DATA_DIR apontando para um disco persistente (ex: no Render,
// o "Persistent Disk" monta em algo como /var/data). Sem isso, cai na pasta local
// do projeto — ok para estudo, mas em muitos hosts isso é apagado a cada deploy.
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "data.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---- Schema ----
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  avatar_url TEXT,
  banner_url TEXT,
  bio TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id),
  invite_code TEXT UNIQUE NOT NULL,
  icon_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'text', -- 'text' | 'voice'
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS server_members (
  server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'admin' | 'member'
  joined_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (server_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL DEFAULT '',
  attachment_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dm_messages (
  id TEXT PRIMARY KEY,
  pair_key TEXT NOT NULL, -- "userIdA:userIdB" com IDs ordenados, identifica a conversa
  from_user_id TEXT NOT NULL REFERENCES users(id),
  to_user_id TEXT NOT NULL REFERENCES users(id),
  content TEXT NOT NULL DEFAULT '',
  attachment_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(pair_key);
`);

// Migração leve para bancos criados antes destas colunas existirem
const msgCols = db.prepare("PRAGMA table_info(messages)").all().map((c) => c.name);
if (!msgCols.includes("attachment_url")) {
  db.exec("ALTER TABLE messages ADD COLUMN attachment_url TEXT");
}

const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes("avatar_url")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
}
if (!userCols.includes("banner_url")) {
  db.exec("ALTER TABLE users ADD COLUMN banner_url TEXT");
}
if (!userCols.includes("bio")) {
  db.exec("ALTER TABLE users ADD COLUMN bio TEXT");
}

const serverCols = db.prepare("PRAGMA table_info(servers)").all().map((c) => c.name);
if (!serverCols.includes("icon_url")) {
  db.exec("ALTER TABLE servers ADD COLUMN icon_url TEXT");
}

export default db;
