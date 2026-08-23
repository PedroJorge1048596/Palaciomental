import { createPortal } from "react-dom";

// Renderiza direto em document.body em vez de ficar aninhado dentro de quem
// o chamou (server-rail, channel-col, etc). Isso elimina de vez qualquer
// problema de contexto de empilhamento do CSS: não importa o que um
// componente pai faça (transform, animação, overflow...), o modal sempre
// aparece por cima de tudo.
export default function Modal({ onClose, children, className = "" }) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body
  );
}
