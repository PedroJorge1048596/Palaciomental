import { io } from "socket.io-client";

let socket = null;

// Em produção, defina VITE_SOCKET_URL com a URL pública do backend (ex: https://seu-backend.onrender.com).
// Se não for definida, cai no comportamento de sempre (backend local na porta 4000).
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:4000";

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(SOCKET_URL, { auth: { token } });
  return socket;
}

export function getSocket() {
  return socket;
}
