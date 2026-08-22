import { useEffect, useState } from "react";
import { api } from "../api";
import ChatArea from "./ChatArea.jsx";
import Avatar from "./Avatar.jsx";

export default function DirectMessages({ token, currentUser, onOpenProfile }) {
  const [contacts, setContacts] = useState([]);
  const [active, setActive] = useState(null);

  useEffect(() => {
    api.getDmContacts(token).then(setContacts);
  }, [token]);

  return (
    <>
      <div className="channel-col">
        <div className="channel-col-header">
          <span>Mensagens diretas</span>
        </div>
        <div className="channel-group">
          <div className="channel-group-title"><span>Contatos</span></div>
          {contacts.length === 0 && (
            <div className="dm-empty-hint">
              Você ainda não compartilha nenhum servidor com outra pessoa. Entre em um servidor com outros membros para poder mandar DM.
            </div>
          )}
          {contacts.map((c) => (
            <button
              key={c.id}
              className={`channel-item dm-contact ${active?.id === c.id ? "active" : ""}`}
              onClick={() => setActive(c)}
            >
              <Avatar
                className="member-avatar dm-contact-avatar"
                url={c.avatar_url}
                color={c.avatar_color}
                name={c.username}
              />
              {c.username}
            </button>
          ))}
        </div>
      </div>

      <ChatArea
        key={active?.id}
        mode="dm"
        target={active}
        token={token}
        currentUser={currentUser}
        onOpenProfile={onOpenProfile}
      />
    </>
  );
}
