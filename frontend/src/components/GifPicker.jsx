import { useEffect, useRef, useState } from "react";
import { api } from "../api";

export default function GifPicker({ token, onPick, onClose }) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ref = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  useEffect(() => {
    loadGifs("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadGifs(q) {
    setLoading(true);
    setError("");
    const fetcher = q.trim() ? api.searchGifs(token, q.trim()) : api.getFeaturedGifs(token);
    fetcher
      .then((data) => setGifs(data.results || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  function handleQueryChange(value) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadGifs(value), 350);
  }

  return (
    <div className="gif-picker" ref={ref}>
      <input
        className="gif-picker-search"
        placeholder="Buscar gifs no Tenor…"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        autoFocus
      />
      <div className="gif-picker-grid">
        {loading && <div className="gif-picker-status">Carregando…</div>}
        {!loading && error && <div className="gif-picker-status">{error}</div>}
        {!loading && !error && gifs.length === 0 && (
          <div className="gif-picker-status">Nenhum gif encontrado.</div>
        )}
        {!loading &&
          !error &&
          gifs.map((g) => (
            <button
              type="button"
              key={g.id}
              className="gif-picker-item"
              onClick={() => onPick(g.url)}
              title={g.title}
            >
              <img src={g.previewUrl} alt={g.title} loading="lazy" />
            </button>
          ))}
      </div>
    </div>
  );
}
