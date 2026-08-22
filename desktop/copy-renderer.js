// Copia frontend/dist (o build de produção do React) para desktop/renderer,
// que é de onde o Electron carrega a interface (ver main.js).
// Roda automaticamente antes de "npm start" e "npm run dist" (ver package.json).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, "..", "frontend", "dist");
const dest = path.join(__dirname, "renderer");

if (!fs.existsSync(src)) {
  console.error(
    "\nfrontend/dist não encontrado.\n" +
      "Antes de rodar o app desktop, gere o build do frontend:\n" +
      "  cd ../frontend\n" +
      "  npm run build\n" +
      "(configure frontend/.env.production com a URL do seu backend publicado antes de buildar — veja o DESKTOP.md)\n"
  );
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Renderer copiado de frontend/dist para desktop/renderer.");
