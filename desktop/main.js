import { app, BrowserWindow } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Palácio Mental",
    backgroundColor: "#0E2A3E", // evita o "flash branco" enquanto a página carrega
    autoHideMenuBar: true, // esconde a barra de menu padrão do Electron (File/Edit/View...)
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Carrega o frontend já compilado (copiado de frontend/dist para desktop/renderer
  // pelo script copy-renderer.js — ver package.json).
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    // No macOS é comum recriar a janela ao clicar no ícone do dock
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
