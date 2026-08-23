// Baixa o binário standalone do yt-dlp (não precisa de Python — é um
// executável já empacotado) direto dos releases oficiais no GitHub, pra
// dentro de backend/bin/. É isso que o musicBot.js usa pra baixar áudio
// do YouTube.
//
// Por que não usar o pacote "yt-dlp-exec"? O postinstall dele tenta checar
// se existe um binário `python` no PATH do sistema (herdado da linhagem do
// youtube-dl-exec) — e em muita máquina Windows isso falha mesmo sem
// precisar de Python de verdade pra rodar o yt-dlp, derrubando o `npm
// install` inteiro. Baixar o binário direto evita essa dor de cabeça.
//
// Esse script NUNCA falha o `npm install`: se o download não rolar agora
// (sem internet no build, GitHub fora do ar, etc.), só avisa no console —
// os comandos m!p/m!s/m!stop simplesmente não vão funcionar até o binário
// existir em backend/bin/ (ou em algum "yt-dlp"/"yt-dlp.exe" já no PATH).

import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.join(__dirname, "..");
const binDir = path.join(backendRoot, "bin");

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const fileName = isWin ? "yt-dlp.exe" : isMac ? "yt-dlp_macos" : "yt-dlp";
const destName = isWin ? "yt-dlp.exe" : "yt-dlp"; // no mac, salva com o nome genérico "yt-dlp" também
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${fileName}`;
const dest = path.join(binDir, destName);

function download(fromUrl, toPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(fromUrl, { headers: { "User-Agent": "PalacioMental-installer" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error("Redirecionamentos demais"));
          res.resume();
          return resolve(download(res.headers.location, toPath, redirectsLeft - 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} ao baixar ${fromUrl}`));
        }
        const file = fs.createWriteStream(toPath);
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  try {
    if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

    if (fs.existsSync(dest)) {
      console.log(`[install-ytdlp] já existe em ${dest}, pulando download.`);
      return;
    }

    console.log(`[install-ytdlp] baixando yt-dlp (${process.platform})...`);
    await download(url, dest);
    if (!isWin) fs.chmodSync(dest, 0o755);
    console.log(`[install-ytdlp] pronto: ${dest}`);
  } catch (err) {
    console.warn(`[install-ytdlp] AVISO: não consegui baixar o yt-dlp automaticamente (${err.message}).`);
    console.warn(
      "[install-ytdlp] os comandos m!p/m!s/m!stop do bot de música não vão funcionar até você colocar " +
        "o binário manualmente em backend/bin/ (baixe em https://github.com/yt-dlp/yt-dlp/releases) " +
        "ou instalar 'yt-dlp' no PATH do sistema."
    );
    // Não relança o erro — isso NÃO pode derrubar o "npm install" do resto do projeto.
  }
}

main();
