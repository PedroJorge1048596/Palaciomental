import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { getSocket } from "../socket";
import EmojiPicker from "./EmojiPicker.jsx";
import GifPicker from "./GifPicker.jsx";
import Avatar from "./Avatar.jsx";

function formatTime(iso) {
  const d = new Date(iso + "Z");
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * mode: "channel" | "dm"
 * target: canal ({id, name}) quando mode="channel", ou usuário ({id, username}) quando mode="dm"
 */
export default function ChatArea({ mode = "channel", target, token, currentUser, onOpenProfile }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [showEmoji, setShowEmoji] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);

  const isDm = mode === "dm";
  const identityKeyField = isDm ? "from_user_id" : "user_id";

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    const socket = getSocket();

    const loadMessages = isDm ? api.getDmMessages(token, target.id) : api.getMessages(token, target.id);
    loadMessages.then((msgs) => {
      if (!cancelled) setMessages(msgs);
    });

    if (isDm) socket.emit("dm:join", target.id);
    else socket.emit("channel:join", target.id);

    function handleNew(msg) {
      if (cancelled) return;
      if (isDm && msg.from_user_id !== target.id && msg.from_user_id !== currentUser.id) return;
      setMessages((prev) => [...prev, msg]);
    }

    const eventName = isDm ? "dm:new" : "message:new";
    socket.on(eventName, handleNew);

    return () => {
      cancelled = true;
      if (isDm) socket.emit("dm:leave", target.id);
      else socket.emit("channel:leave", target.id);
      socket.off(eventName, handleNew);
      setMessages([]);
    };
  }, [mode, target?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function send(e) {
    e?.preventDefault();
    if (!draft.trim()) return;
    if (isDm) getSocket().emit("dm:send", { toUserId: target.id, content: draft.trim() });
    else getSocket().emit("message:send", { channelId: target.id, content: draft.trim() });
    setDraft("");
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const { url } = await api.uploadImage(token, file);
      if (isDm) getSocket().emit("dm:send", { toUserId: target.id, content: "", attachmentUrl: url });
      else getSocket().emit("message:send", { channelId: target.id, content: "", attachmentUrl: url });
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function pickEmoji(emoji) {
    setDraft((d) => d + emoji);
  }

  function pickGif(gifUrl) {
    if (isDm) getSocket().emit("dm:send", { toUserId: target.id, content: "", attachmentUrl: gifUrl });
    else getSocket().emit("message:send", { channelId: target.id, content: "", attachmentUrl: gifUrl });
    setShowGifs(false);
  }

  if (!target) {
    return <div className="chat-empty">Escolha uma conversa para começar.</div>;
  }

  return (
    <div className="chat-area">
      <div className="chat-header">{isDm ? `@ ${target.username}` : `# ${target.name}`}</div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty-inline">Nenhuma mensagem ainda — seja o primeiro a falar 👋</div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const authorId = m[identityKeyField];
          const prevAuthorId = prev?.[identityKeyField];
          const grouped = prev && prevAuthorId === authorId;
          return (
            <div key={m.id} className={`message-row ${grouped ? "grouped" : ""}`}>
              {!grouped && (
                <Avatar
                  className="message-avatar"
                  url={m.avatar_url}
                  color={m.avatar_color}
                  name={m.username}
                  onClick={onOpenProfile ? () => onOpenProfile(authorId) : undefined}
                  title={m.username}
                />
              )}
              <div className="message-body">
                {!grouped && (
                  <div className="message-meta">
                    <span className="message-author">{m.username}</span>
                    <span className="message-time">{formatTime(m.created_at)}</span>
                  </div>
                )}
                {m.content && <div className="message-content">{m.content}</div>}
                {m.attachment_url && (
                  <a href={m.attachment_url} target="_blank" rel="noreferrer">
                    <img className="message-image" src={m.attachment_url} alt="imagem enviada" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <form className="chat-input-bar" onSubmit={send}>
        <button
          type="button"
          className="btn-icon"
          title="Enviar imagem"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "…" : "📎"}
        </button>
        <input type="file" accept="image/*" ref={fileInputRef} hidden onChange={handleFile} />

        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={isDm ? `Conversar com ${target.username}` : `Conversar em #${target.name}`}
        />

        <div className="emoji-wrap">
          <button
            type="button"
            className="btn-icon"
            title="Enviar gif"
            onClick={() => setShowGifs((v) => !v)}
          >
            GIF
          </button>
          {showGifs && <GifPicker token={token} onPick={pickGif} onClose={() => setShowGifs(false)} />}
        </div>

        <div className="emoji-wrap">
          <button type="button" className="btn-icon" title="Emoji" onClick={() => setShowEmoji((v) => !v)}>
            🙂
          </button>
          {showEmoji && <EmojiPicker onPick={pickEmoji} onClose={() => setShowEmoji(false)} />}
        </div>

        <button type="submit" className="btn-send">Enviar</button>
      </form>
    </div>
  );
}
