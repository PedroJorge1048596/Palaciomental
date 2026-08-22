import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuid } from "uuid";
import { requireAuth } from "../auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Mesma lógica do db.js: em produção, DATA_DIR deve apontar para um disco persistente,
// senão as imagens enviadas somem a cada deploy/reinício.
const dataDir = process.env.DATA_DIR || path.join(__dirname, "..", "..");
const uploadsDir = path.join(dataDir, "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(new Error("Apenas imagens (png, jpg, gif, webp) são permitidas"));
    }
    cb(null, true);
  },
});

const router = Router();
router.use(requireAuth);

router.post("/", (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Nenhum arquivo enviado" });
    // URL absoluta (não só "/uploads/...") — necessário pra funcionar quando quem carrega
    // a imagem não está no mesmo domínio do backend, como no app desktop (Electron) ou
    // quando frontend e backend ficam em hospedagens separadas.
    const url = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({ url });
  });
});

export default router;
