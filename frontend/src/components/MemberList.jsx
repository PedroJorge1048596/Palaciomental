import Avatar from "./Avatar.jsx";

const ROLE_LABEL = { owner: "Dono", admin: "Admin", member: "Membro" };

export default function MemberList({ members, isOwner, onChangeRole, onOpenProfile, onRemoveMember }) {
  return (
    <div className="member-col">
      <div className="member-col-title">Membros — {members.length}</div>
      {members.map((m) => (
        <div key={m.id} className="member-row">
          <Avatar
            className="member-avatar"
            url={m.avatar_url}
            color={m.avatar_color}
            name={m.username}
            onClick={onOpenProfile ? () => onOpenProfile(m.id) : undefined}
            title="Ver perfil"
          />
          <div className="member-info">
            <span className="member-name">{m.username}</span>
            <span className={`member-role role-${m.role}`}>{ROLE_LABEL[m.role]}</span>
          </div>
          {isOwner && m.role !== "owner" && (
            <select
              className="member-role-select"
              value={m.role}
              onChange={(e) => onChangeRole(m.id, e.target.value)}
            >
              <option value="member">Membro</option>
              <option value="admin">Admin</option>
            </select>
          )}
          {isOwner && m.role !== "owner" && (
            <button
              type="button"
              className="member-kick-btn"
              title="Remover do servidor"
              onClick={() => {
                if (confirm(`Remover ${m.username} do servidor? Essa ação não pode ser desfeita.`)) {
                  onRemoveMember(m.id);
                }
              }}
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
