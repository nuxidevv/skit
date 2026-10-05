import https from "https";

const BRIXHUB_URL = "https://brixhub.to/";
const CACHE_TTL = 3600 * 1000; // 1 heure
const FALLBACK = 14538227469;

let cache = { value: null, at: 0 };

function fetchPage(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"
      }
    };
    const req = https.request(options, (res) => {
      // Suit les redirections
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(fetchPage(res.headers.location));
      }
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", (e) => resolve({ status: 0, body: "", error: e.message }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ status: 0, body: "", error: "timeout" }); });
    req.end();
  });
}

function extractBiggestNumber(html) {
  const candidates = [];

  // Pattern principal : "XX XXX XXX XXX" ou "X XXX XXX XXX" (espaces, virgules, points)
  const re1 = /\b(\d{1,3}(?:[\s,\.]\d{3}){2,})\b/g;
  let m;
  while ((m = re1.exec(html)) !== null) {
    const clean = m[1].replace(/[\s,\.]/g, "");
    const n = parseInt(clean, 10);
    if (!isNaN(n) && n > 1000000) candidates.push(n);
  }

  // Pattern alternatif : nombre brut long (au moins 10 chiffres collés)
  const re2 = /\b(\d{10,})\b/g;
  while ((m = re2.exec(html)) !== null) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 1000000) candidates.push(n);
  }

  if (!candidates.length) return null;
  return Math.max(...candidates);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Cache
  const now = Date.now();
  if (cache.value && (now - cache.at) < CACHE_TTL) {
    return res.status(200).json({
      ok: true,
      total: cache.value,
      cached: true,
      source: "brixhub.to"
    });
  }

  try {
    const r = await fetchPage(BRIXHUB_URL);
    if (r.status !== 200 || !r.body) {
      return res.status(200).json({
        ok: false,
        total: FALLBACK,
        cached: false,
        error: r.error || `HTTP ${r.status}`,
        source: "fallback"
      });
    }

    const total = extractBiggestNumber(r.body);
    if (!total) {
      return res.status(200).json({
        ok: false,
        total: FALLBACK,
        cached: false,
        error: "no-number-found",
        source: "fallback"
      });
    }

    cache = { value: total, at: now };

    return res.status(200).json({
      ok: true,
      total,
      cached: false,
      source: "brixhub.to"
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      total: FALLBACK,
      cached: false,
      error: e.message,
      source: "fallback"
    });
  }
}
