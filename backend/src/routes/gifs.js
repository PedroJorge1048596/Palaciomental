import { Router } from "express";
import { requireAuth } from "../auth.js";

const router = Router();
router.use(requireAuth);

// Chave pública de testes do Giphy (limitada e compartilhada — troque pela sua em
// https://developers.giphy.com/dashboard/ e defina GIPHY_API_KEY no ambiente antes de ir pra produção).
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || "dc6zaTOxFJmzC";

function mapResults(data) {
  return (data.data || []).map((g) => {
    const gifMedia = g.images?.original || g.images?.downsized;
    const previewMedia = g.images?.fixed_width || g.images?.fixed_width_small || gifMedia;
    return {
      id: g.id,
      title: g.title || "gif",
      url: gifMedia?.url,
      previewUrl: previewMedia?.url || gifMedia?.url,
      width: gifMedia?.width ? Number(gifMedia.width) : undefined,
      height: gifMedia?.height ? Number(gifMedia.height) : undefined,
    };
  }).filter((g) => g.url);
}

router.get("/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ results: [] });

  try {
    const url = new URL("https://api.giphy.com/v1/gifs/search");
    url.searchParams.set("q", q);
    url.searchParams.set("api_key", GIPHY_API_KEY);
    url.searchParams.set("limit", "24");
    url.searchParams.set("rating", "pg-13");
    url.searchParams.set("lang", "pt");

    const giphyRes = await fetch(url);
    if (!giphyRes.ok) throw new Error(`Giphy respondeu ${giphyRes.status}`);
    const data = await giphyRes.json();
    res.json({ results: mapResults(data) });
  } catch (err) {
    res.status(502).json({ error: "Não foi possível buscar gifs agora: " + err.message });
  }
});

router.get("/featured", async (req, res) => {
  try {
    const url = new URL("https://api.giphy.com/v1/gifs/trending");
    url.searchParams.set("api_key", GIPHY_API_KEY);
    url.searchParams.set("limit", "24");
    url.searchParams.set("rating", "pg-13");

    const giphyRes = await fetch(url);
    if (!giphyRes.ok) throw new Error(`Giphy respondeu ${giphyRes.status}`);
    const data = await giphyRes.json();
    res.json({ results: mapResults(data) });
  } catch (err) {
    res.status(502).json({ error: "Não foi possível buscar gifs agora: " + err.message });
  }
});

export default router;
