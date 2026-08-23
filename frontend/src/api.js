// Em produção com frontend e backend em domínios separados, defina VITE_API_URL
// com a URL pública do backend (ex: https://seu-backend.onrender.com).
// Deixando em branco, usa caminho relativo "/api" — funciona tanto no dev (proxy do Vite)
// quanto quando o backend serve o próprio frontend (mesmo domínio).
const BASE = (import.meta.env.VITE_API_URL || "") + "/api";

async function request(path, { method = "GET", body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erro na requisição");
  return data;
}

export const api = {
  register: (username, password) =>
    request("/auth/register", { method: "POST", body: { username, password } }),
  login: (username, password) =>
    request("/auth/login", { method: "POST", body: { username, password } }),

  getServers: (token) => request("/servers", { token }),
  createServer: (token, name) => request("/servers", { method: "POST", body: { name }, token }),
  joinServer: (token, inviteCode) =>
    request("/servers/join", { method: "POST", body: { inviteCode }, token }),

  getChannels: (token, serverId) => request(`/servers/${serverId}/channels`, { token }),
  createChannel: (token, serverId, name, type) =>
    request(`/servers/${serverId}/channels`, { method: "POST", body: { name, type }, token }),

  getMembers: (token, serverId) => request(`/servers/${serverId}/members`, { token }),
  setRole: (token, serverId, userId, role) =>
    request(`/servers/${serverId}/members/${userId}/role`, {
      method: "PATCH",
      body: { role },
      token,
    }),
  removeMember: (token, serverId, userId) =>
    request(`/servers/${serverId}/members/${userId}`, { method: "DELETE", token }),

  getMessages: (token, channelId) => request(`/servers/channels/${channelId}/messages`, { token }),

  async uploadImage(token, file) {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(BASE + "/uploads", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Falha no upload");
    return data; // { url }
  },

  getDmContacts: (token) => request("/dms/contacts", { token }),
  getDmMessages: (token, otherUserId) => request(`/dms/${otherUserId}/messages`, { token }),

  getMe: (token) => request("/users/me", { token }),
  getUserProfile: (token, userId) => request(`/users/${userId}`, { token }),
  updateProfile: (token, data) => request("/users/me", { method: "PATCH", body: data, token }),

  updateServer: (token, serverId, data) =>
    request(`/servers/${serverId}`, { method: "PATCH", body: data, token }),

  searchGifs: (token, q) => request(`/gifs/search?q=${encodeURIComponent(q)}`, { token }),
  getFeaturedGifs: (token) => request("/gifs/featured", { token }),
};
