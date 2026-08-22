import { useEffect, useRef } from "react";

const EMOJIS = [
  "😀","😂","😅","😍","🤔","😎","😢","😡","👍","👎",
  "🙏","👏","🔥","🎉","❤️","💀","😴","🤝","👀","✨",
  "🚀","🐱","🍕","☕","🎮","💻","📷","⚡","🌧️","🌙",
];

export default function EmojiPicker({ onPick, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div className="emoji-picker" ref={ref}>
      {EMOJIS.map((e) => (
        <button key={e} type="button" className="emoji-btn" onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
    </div>
  );
}
