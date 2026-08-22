import { useState } from "react";
import { api } from "../api";

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const fn = mode === "login" ? api.login : api.register;
      const data = await fn(username, password);
      onAuth(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark">P</span>
          <h1>Palácio Mental</h1>
        </div>
        <p className="auth-tagline">Um cantinho para o seu grupo se encontrar.</p>

        <form onSubmit={submit} className="auth-form">
          <label>
            Nome de usuário
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="seu-nome"
              autoFocus
            />
          </label>
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? "Um instante…" : mode === "login" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <button className="auth-switch" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "Ainda não tem conta? Criar uma" : "Já tem conta? Entrar"}
        </button>
      </div>
    </div>
  );
}
