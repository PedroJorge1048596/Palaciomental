import { useState } from "react";
import Avatar from "./Avatar.jsx";
import Modal from "./Modal.jsx";

export default function ServerSidebar({ servers, activeServer, viewingDms, onSelect, onCreate, onJoin, onOpenDms, onLogout, theme, onCycleTheme }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");

  return (
    <div className="server-rail">
      <button
        className={`server-icon server-icon--dm ${viewingDms ? "active" : ""}`}
        title="Mensagens diretas"
        onClick={onOpenDms}
      >
        @
      </button>
      <div className="server-rail-divider" />

      {servers.map((s) => (
        <button
          key={s.id}
          className={`server-icon ${activeServer?.id === s.id ? "active" : ""}`}
          onClick={() => onSelect(s)}
          title={s.name}
        >
          {s.icon_url ? (
            <Avatar className="server-icon-img" url={s.icon_url} name={s.name} />
          ) : (
            s.name.slice(0, 2).toUpperCase()
          )}
        </button>
      ))}

      <div className="server-rail-divider" />

      <button className="server-icon server-icon--action" title="Criar servidor" onClick={() => setShowCreate(true)}>
        +
      </button>
      <button className="server-icon server-icon--action" title="Entrar com convite" onClick={() => setShowJoin(true)}>
        ↵
      </button>
      <button
        className="server-icon server-icon--action server-icon--theme"
        title={`Tema: ${{ default: "Padrão", dark: "Escuro", light: "Claro" }[theme]} — clique para trocar`}
        onClick={onCycleTheme}
      >
        {{ default: "◐", dark: "☾", light: "☀" }[theme]}
      </button>

      <div className="server-rail-spacer" />
      <button
        className="server-icon server-icon--action server-icon--logout"
        title="Sair da conta"
        onClick={() => {
          if (confirm("Sair da sua conta neste dispositivo?")) onLogout();
        }}
      >
        ⏻
      </button>

      {showCreate && (
        <Modal onClose={() => setShowCreate(false)}>
          <h3>Criar um novo servidor</h3>
          <input
            placeholder="Nome do servidor"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button
            className="btn-primary"
            onClick={async () => {
              if (!name.trim()) return;
              await onCreate(name.trim());
              setName("");
              setShowCreate(false);
            }}
          >
            Criar
          </button>
        </Modal>
      )}

      {showJoin && (
        <Modal onClose={() => setShowJoin(false)}>
          <h3>Entrar com código de convite</h3>
          <input
            placeholder="ex: a1b2c3"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <button
            className="btn-primary"
            onClick={async () => {
              if (!code.trim()) return;
              await onJoin(code.trim());
              setCode("");
              setShowJoin(false);
            }}
          >
            Entrar
          </button>
        </Modal>
      )}
    </div>
  );
}
