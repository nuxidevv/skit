import https from "https";

/**
 * Envoie un log anonymisé sur Discord.
 * Ne bloque JAMAIS la réponse (fire and forget).
 * Ne plante JAMAIS si le webhook est absent/HS.
 */
export function logToDiscord(data) {
  const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
  if (!WEBHOOK_URL) return; // Pas configuré → on skip silencieusement

  // Optionnel : ne logger qu'en prod (décommente si tu veux)
  // if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return;

  try {
    const u = new URL(WEBHOOK_URL);

    const ok = data.ok === true;
    const color = ok ? 0x22c55e : 0xef4444; // vert / rouge
    const statusIcon = ok ? "✅" : "❌";
    const statusText = ok ? "OK" : "Erreur";

    const fields = [
      { name: "🔍 Type", value: data.searchType || "Inconnu", inline: true },
      { name: "⏱️ Temps", value: `${data.duration || 0} ms`, inline: true },
      { name: "📊 Résultats", value: String(data.resultCount ?? 0), inline: true }
    ];

    if (data.apiStatus != null) {
      fields.push({ name: "🌐 API", value: `HTTP ${data.apiStatus}`, inline: true });
    }

    if (data.error) {
      fields.push({
        name: "⚠️ Erreur",
        value: String(data.error).slice(0, 500),
        inline: false
      });
    }

    const payload = {
      username: "Seek It — Logs",
      embeds: [
        {
          title: `${statusIcon} Recherche ${statusText}`,
          color,
          fields,
          timestamp: new Date().toISOString(),
          footer: {
            text: "Seek It • Logs techniques anonymisés"
          }
        }
      ]
    };

    const body = JSON.stringify(payload);

    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": "SeekIt-Logger/1.0"
      }
    };

    const req = https.request(options, (res) => {
      res.on("data", () => {});
      res.on("end", () => {});
    });

    req.on("error", () => {
      // Silencieux : si Discord est down, on ne casse rien
    });

    // Timeout court : on ne veut pas bloquer
    req.setTimeout(3000, () => {
      req.destroy();
    });

    req.write(body);
    req.end();
  } catch (e) {
    // Silencieux : aucune erreur ne doit remonter au client
  }
}
