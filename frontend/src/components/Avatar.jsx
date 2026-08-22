// Avatar reutilizável: mostra a imagem de perfil do usuário quando existe,
// e cai de volta pras iniciais coloridas (comportamento original) quando não.
export default function Avatar({ url, color, name, className = "", onClick, title }) {
  const initials = (name || "?").slice(0, 2).toUpperCase();

  if (url) {
    return (
      <img
        className={className}
        src={url}
        alt={name || "avatar"}
        onClick={onClick}
        title={title}
        style={onClick ? { cursor: "pointer" } : undefined}
      />
    );
  }

  return (
    <div
      className={className}
      style={{ background: color, cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
      title={title}
    >
      {initials}
    </div>
  );
}
