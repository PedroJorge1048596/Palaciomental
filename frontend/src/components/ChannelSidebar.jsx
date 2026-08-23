import { useRef, useState } from "react";
import { api } from "../api";
import Avatar from "./Avatar.jsx";
import Modal from "./Modal.jsx";

export default function ChannelSidebar({
  server,
  channels,
  activeChannel,
  onSelect,
  onCreateChannel,
  canManage,
  currentUser,
  voicePresence = {},
  token,
  isOwner,
  onOpenProfile,
  onUpdateServerIcon,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [uploadingIcon, setUploadingIcon] = useState(false);
  const [iconError, setIconError] = useState("");
  const iconInputRef = useRef(null);

  async function handleIconFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIconError("");
    setUploadingIcon(true);
    try {
      const { url } = await api.uploadImage(token, file);
      await onUpdateServerIcon(url);
    } catch (err) {
      setIconError(err.message);
    } finally {
      setUploadingIcon(false);
    }
  }

  const textChannels = channels.filter((c) => c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  return (
    <div className="channel-col">
      <div className="channel-col-header">
        <div className="channel-col-header-title">
          {server.icon_url && (
            <img className="channel-col-header-icon" src={server.icon_url} alt={server.name} />
          )}
          <span>{server.name}</span>
          {isOwner && (
            <button
              type="button"
              className="channel-icon-edit"
              onClick={() => iconInputRef.current?.click()}
              disabled={uploadingIcon}
              title="Trocar ícone do servidor"
            >
              {uploadingIcon ? "…" : "✏️"}
            </button>
          )}
          <input
            type="file"
            accept="image/*"
            hidden
            ref={iconInputRef}
            onChange={handleIconFile}
          />
        </div>
        <span className="invite-code" title="Código de convite para compartilhar">{server.invite_code}</span>
      </div>
      {iconError && <div className="chat-error">{iconError}</div>}

      <div className="channel-group">
        <div className="channel-group-title">
          <span>Canais de texto</span>
          {canManage && (
            <button className="channel-add" onClick={() => { setType("text"); setShowCreate(true); }}>+</button>
          )}
        </div>
        {textChannels.map((c) => (
          <button
            key={c.id}
            className={`channel-item ${activeChannel?.id === c.id ? "active" : ""}`}
            onClick={() => onSelect(c)}
          >
            <span className="channel-hash">#</span> {c.name}
          </button>
        ))}
      </div>

      <div className="channel-group">
        <div className="channel-group-title">
          <span>Canais de voz</span>
          {canManage && (
            <button className="channel-add" onClick={() => { setType("voice"); setShowCreate(true); }}>+</button>
          )}
        </div>
        {voiceChannels.map((c) => {
          const presence = voicePresence[c.id] || [];
          return (
            <div key={c.id} className="voice-channel-block">
              <button
                className={`channel-item ${activeChannel?.id === c.id ? "active" : ""}`}
                onClick={() => onSelect(c)}
              >
                <span className="channel-hash">🔊</span> {c.name}
              </button>
              {presence.length > 0 && (
                <div className="voice-presence-list">
                  {presence.map((p) => (
                    <div key={p.socketId} className="voice-presence-item">
                      {p.avatarUrl ? (
                        <img className="voice-presence-avatar voice-presence-avatar--img" src={p.avatarUrl} alt={p.username} />
                      ) : (
                        <span className="voice-presence-avatar" style={p.avatarColor ? { background: p.avatarColor } : undefined}>
                          {p.username?.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="voice-presence-name">{p.username}</span>
                      {p.sharing && <span className="voice-presence-live">AO VIVO</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="channel-col-footer">
        <Avatar
          className="me-avatar"
          url={currentUser.avatar_url}
          color={currentUser.avatar_color}
          name={currentUser.username}
          onClick={() => onOpenProfile?.(currentUser.id)}
          title="Ver/editar perfil"
        />
        <span>{currentUser.username}</span>
      </div>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <h3>Criar canal de {type === "voice" ? "voz" : "texto"}</h3>
          <input
            placeholder="nome-do-canal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button
            className="btn-primary"
            onClick={async () => {
              if (!name.trim()) return;
              await onCreateChannel(name.trim(), type);
              setName("");
              setShowCreate(false);
            }}
          >
            Criar
          </button>
        </Modal>
      )}
    </div>
  );
}
