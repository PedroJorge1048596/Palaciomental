import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState("login"); // 'login' | 'register'
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const audioRef = useRef(null);
  const videoRef = useRef(null);
  const videoBlurRef = useRef(null);

  // Defesa extra contra o glitch de "linha preta" ao trocar de aba: o Chrome
  // às vezes pausa a decodificação de vídeos em segundo plano pra economizar
  // recursos, e nem sempre retoma sozinho do jeito esperado quando a aba volta
  // a ficar visível. Isso força os dois vídeos (e a música) a continuarem
  // tocando assim que a página volta a ficar visível.
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      videoRef.current?.play().catch(() => {});
      videoBlurRef.current?.play().catch(() => {});
      const audio = audioRef.current;
      if (audio && !audio.ended && audio.volume > 0) audio.play().catch(() => {});
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  // Assim que a tela de login aparece, toca a música tema em volume médio.
  // Navegadores bloqueiam autoplay COM som sem interação do usuário — por isso
  // o play() roda dentro de um try/catch silencioso; se o navegador recusar,
  // a música só começa quando a pessoa interagir com a página (ex: focar um campo).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.5;
    audio.play().catch(() => {
      const retry = () => {
        audio.play().catch(() => {});
        window.removeEventListener("pointerdown", retry);
      };
      window.addEventListener("pointerdown", retry, { once: true });
    });
  }, []);

  // Reduz o volume gradualmente até 0 ao longo de ~1.2s (usado no momento do login).
  function fadeOutAudio() {
    return new Promise((resolve) => {
      const audio = audioRef.current;
      if (!audio) return resolve();
      const steps = 24;
      const stepTime = 1200 / steps;
      const startVolume = audio.volume;
      let i = 0;
      const timer = setInterval(() => {
        i++;
        audio.volume = Math.max(0, startVolume * (1 - i / steps));
        if (i >= steps) {
          clearInterval(timer);
          audio.pause();
          resolve();
        }
      }, stepTime);
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const fn = mode === "login" ? api.login : api.register;
      const data = await fn(username, password);
      setLeaving(true); // dispara o fade visual (via CSS) em paralelo com o fade da música
      await fadeOutAudio();
      onAuth(data);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  return (
    <div className={`auth-screen ${leaving ? "auth-screen--leaving" : ""}`}>
      <video
        ref={videoRef}
        className="auth-bg-video"
        src="/auth-bg.mp4"
        autoPlay
        muted
        loop
        playsInline
      />
      <div className="auth-bg-video-blur-wrap" aria-hidden="true">
        <video
          ref={videoBlurRef}
          className="auth-bg-video-blur"
          src="/auth-bg.mp4"
          autoPlay
          muted
          loop
          playsInline
        />
      </div>
      <audio ref={audioRef} src="/auth-theme.mp3" loop />

      <div className="auth-card auth-card--mono">
        <div className="auth-brand">
          <img className="auth-brand-mark" src="/brand-icon.png" alt="Concord" />
          <h1>Concord</h1>
        </div>

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
