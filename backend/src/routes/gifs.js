import { Router } from "express";
import { requireAuth } from "../auth.js";

const router = Router();
router.use(requireAuth);

// Chave pública de testes do Tenor (limitada e compartilhada — troque pela sua em
// https://tenor.com/gifapi e defina TENOR_API_KEY no ambiente antes de ir pra produção).
const TENOR_API_KEY = process.env.TENOR_API_KEY || "LIVDSRZULELA";
const TENOR_CLIENT_KEY = "palacio_mental";

function mapResults(data) {
  return (data.results || []).map((g) => {
    const gifMedia = g.media_formats?.gif || g.media_formats?.mediumgif || g.media_formats?.tinygif;
    const previewMedia = g.media_formats?.tinygif || g.media_formats?.nanogif || gifMedia;
    return {
      id: g.id,
      title: g.content_description || g.title || "gif",
      url: gifMedia?.url,
      previewUrl: previewMedia?.url || gifMedia?.url,
      width: gifMedia?.dims?.[0],
      height: gifMedia?.dims?.[1],
    };
  }).filter((g) => g.url);
}

router.get("/search", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  if (!q) return res.json({ results: [] });

  try {
    const url = new URL("https://tenor.googleapis.com/v2/search");
    url.searchParams.set("q", q);
    url.searchParams.set("key", TENOR_API_KEY);
    url.searchParams.set("client_key", TENOR_CLIENT_KEY);
    url.searchParams.set("limit", "24");
    url.searchParams.set("media_filter", "gif,tinygif,nanogif");
    url.searchParams.set("contentfilter", "medium");

    const tenorRes = await fetch(url);
    if (!tenorRes.ok) throw new Error(`Tenor respondeu ${tenorRes.status}`);
    const data = await tenorRes.json();
    res.json({ results: mapResults(data) });
  } catch (err) {
    res.status(502).json({ error: "Não foi possível buscar gifs agora: " + err.message });
  }
});

router.get("/featured", async (req, res) => {
  try {
    const url = new URL("https://tenor.googleapis.com/v2/featured");
    url.searchParams.set("key", TENOR_API_KEY);
    url.searchParams.set("client_key", TENOR_CLIENT_KEY);
    url.searchParams.set("limit", "24");
    url.searchParams.set("media_filter", "gif,tinygif,nanogif");
    url.searchParams.set("contentfilter", "medium");

    const tenorRes = await fetch(url);
    if (!tenorRes.ok) throw new Error(`Tenor respondeu ${tenorRes.status}`);
    const data = await tenorRes.json();
    res.json({ results: mapResults(data) });
  } catch (err) {
    res.status(502).json({ error: "Não foi possível buscar gifs agora: " + err.message });
  }
});

export default router;
