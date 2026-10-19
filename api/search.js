import https from "https";
import { logToDiscord } from "./logger.js";

// ===== BLOCAGE BASE64 (Nuhi, Xhaferi) =====
const BLOCKED_B64 = ["eGhhZmVyaQ==", "bnVoaQ=="];

function isBlockedSearch(firstName, lastName) {
  const words = [];
  if (firstName) words.push(firstName);
  if (lastName) words.push(lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  if (fullName) {
    const parts = fullName.split(/\s+/);
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) words.push(parts[i]);
    }
  }

  const blockedWords = BLOCKED_B64.map(function(b) {
    return Buffer.from(b, "base64").toString("utf8").toLowerCase();
  });

  for (let j = 0; j < words.length; j++) {
    const w = String(words[j]).toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
    if (blockedWords.indexOf(w) !== -1) return true;
  }
  return false;
}
// ==========================================

const VORTEX_URL = "https://api.brixhub.ru/api/v1/search";

const BLOCKED_TARGETS = [
  { prenom: "leo",    nom: "roman" },
  { prenom: "lucile", nom: "roman" },
  { prenom: "jimmy",  nom: "roman" },
  { prenom: "tom",    nom: "roman" }
];

const BLOCKED_LAST_NAMES_B64 = ["eGhhZmVyaQ=="];

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlocked(fullName) {
  const norm = normalizeName(fullName);
  if (!norm) return false;
  const tokens = norm.split(" ").filter(t => t.length > 0);
  return BLOCKED_TARGETS.some(t => {
    const hasPrenomComplet = tokens.includes(t.prenom);
    const hasNomComplet = tokens.includes(t.nom);
    if (hasPrenomComplet && hasNomComplet) return true;
    const hasPrenomTronque = tokens.some(tok => tok.length >= 2 && t.prenom.startsWith(tok));
    if (hasPrenomTronque && hasNomComplet) return true;
    const hasNomTronque = tokens.some(tok => tok.length >= 3 && t.nom.startsWith(tok));
    if (hasPrenomComplet && hasNomTronque) return true;
    return false;
  });
}

function getBlockedLastNames() {
  return BLOCKED_LAST_NAMES_B64.map(function(b) {
    return Buffer.from(b, "base64").toString("utf8").toLowerCase();
  });
}

function hasBlockedLastName(item) {
  if (!item || typeof item !== "object") return false;
  const blocked = getBlockedLastNames();

  const lastName = normalizeName(item.nom_famille || item.last_name || "");
  if (lastName) {
    for (let i = 0; i < blocked.length; i++) {
      if (lastName === blocked[i]) return true;
    }
  }

  const displayName = normalizeName(item.nom_affichage || item.name || "");
  if (displayName) {
    const tokens = displayName.split(" ").filter(t => t.length > 0);
    for (let i = 0; i < blocked.length; i++) {
      if (tokens.indexOf(blocked[i]) !== -1) return true;
    }
  }

  return false;
}

function filterResults(data) {
  if (!data || typeof data !== "object") return data;

  function walk(obj, depth) {
    if (depth > 8 || !obj) return obj;
    if (Array.isArray(obj)) {
      return obj
        .filter(function(item) { return !hasBlockedLastName(item); })
        .map(function(item) { return walk(item, depth + 1); });
    }
    if (typeof obj === "object") {
      const result = {};
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        result[keys[i]] = walk(obj[keys[i]], depth + 1);
      }
      return result;
    }
    return obj;
  }

  return walk(data, 0);
}

function httpsPost(url, headers, bodyObj) {
  return new Promise((resolve) => {
    const body = JSON.stringify(bodyObj);
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", (e) => resolve({ status: 0, body: "", error: e.message }));
    req.setTimeout(12000, () => { req.destroy(); resolve({ status: 0, body: "", error: "timeout" }); });
    req.write(body);
    req.end();
  });
}

function emptyResponse(a, b) {
  return {
    data: [],
    message: "ok",
    meta: {
      total: 0,
      page: 1,
      per_page: 10,
      query: { prenom: a, nom_famille: b }
    }
  };
}

async function tryVortex(payload) {
  const headers = { "Accept": "application/json" };
  const r = await httpsPost(VORTEX_URL, headers, payload);
  let parsed = null;
  try { parsed = JSON.parse(r.body); } catch { parsed = r.body; }
  return { ok: r.status >= 200 && r.status < 300, status: r.status, error: r.error || null, data: parsed };
}

function countResults(data) {
  if (!data || typeof data !== "object") return 0;
  for (const k of ["results","data","items","records","hits","matches","persons","people"]) {
    if (Array.isArray(data[k])) return data[k].length;
  }
  if (Array.isArray(data)) return data.length;
  if (data.meta && typeof data.meta.total === "number") return data.meta.total;
  return 0;
}

function respond(res, result) {
  const filtered = filterResults(result.data);
  return res.status(200).json({
    ok: result.ok,
    status: result.status,
    error: result.error || null,
    data: filtered
  });
}

function mergeFilters(payload, filters) {
  const merged = { ...payload };
  Object.keys(filters).forEach(k => {
    const v = filters[k];
    if (v != null && String(v).trim() !== "") {
      merged[k] = String(v).trim();
    }
  });
  return merged;
}

// ===== HELPER LOG (appelé à la fin de chaque requête) =====
function buildLog(startTime, searchType, result, extra) {
  const duration = Date.now() - startTime;
  let resultCount = 0;
  let apiStatus = null;

  if (result && typeof result === "object") {
    if (result.status != null) apiStatus = result.status;
    resultCount = countResults(result.data);
  }

  return {
    ok: !!(result && result.ok),
    searchType,
    duration,
    resultCount,
    apiStatus,
    error: (result && result.error) || (extra && extra.error) || null
  };
}
// ==========================================================

export default async function handler(req, res) {
  const startTime = Date.now();

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const {
    first_name = "",
    last_name = "",
    email = "",
    telephone = "",
    ville = "",
    code_postal = "",
    departement = "",
    pays = "",
    adresse = "",
    adresse_ip = "",
    discord_id = "",
    iban = "",
    bic = "",
    annee_naissance = "",
    genre = "",
    _confidence = ""
  } = req.query;

  // ====== BLOCAGE BASE64 (Nuhi, Xhaferi) ======
  if (isBlockedSearch(first_name, last_name)) {
    logToDiscord(buildLog(startTime, "Bloqué", { ok: true, status: 200, data: [] }));
    return res.status(200).json(emptyResponse(first_name, last_name));
  }
  // ============================================

  const filters = {
    ville, code_postal, departement, pays, adresse,
    adresse_ip, discord_id, iban, bic,
    annee_naissance, genre, _confidence
  };

  const isEmailSearch = String(email).trim().length > 0;
  const isPhoneSearch = String(telephone).trim().length > 0;

  // --- Recherche par email ---
  if (isEmailSearch) {
    const r = await tryVortex(mergeFilters({ email: String(email).trim() }, filters));
    logToDiscord(buildLog(startTime, "Email", r));
    return respond(res, r);
  }

  // --- Recherche par téléphone ---
  if (isPhoneSearch) {
    const cleanPhone = String(telephone).replace(/[\s.\-()]/g, "").trim();
    const r = await tryVortex(mergeFilters({ telephone: cleanPhone }, filters));
    logToDiscord(buildLog(startTime, "Téléphone", r));
    return respond(res, r);
  }

  const a = String(first_name).trim();
  const b = String(last_name).trim();

  const fullQuery = [a, b].filter(Boolean).join(" ").trim();
  const hasFilters = Object.values(filters).some(v => String(v).trim() !== "");

  if (fullQuery.length < 2 && !hasFilters) {
    logToDiscord(buildLog(startTime, "Requête vide", { ok: true, status: 200, data: [] }));
    return res.status(200).json(emptyResponse(a, b));
  }

  if (fullQuery.length >= 2 && isBlocked(fullQuery)) {
    logToDiscord(buildLog(startTime, "Bloqué", { ok: true, status: 200, data: [] }));
    return res.status(200).json(emptyResponse(a, b));
  }

  const hasA = a.length > 0;
  const hasB = b.length > 0;

  // --- Prénom + Nom ---
  if (hasA && hasB) {
    const firstResult = await tryVortex(mergeFilters({ prenom: a, nom_famille: b }, filters));
    if (firstResult.ok && countResults(firstResult.data) > 0) {
      logToDiscord(buildLog(startTime, "Prénom + Nom", firstResult));
      return respond(res, firstResult);
    }
    const secondResult = await tryVortex(mergeFilters({ prenom: b, nom_famille: a }, filters));
    if (secondResult.ok && countResults(secondResult.data) > 0) {
      logToDiscord(buildLog(startTime, "Nom + Prénom (inversé)", secondResult));
      return respond(res, secondResult);
    }
    logToDiscord(buildLog(startTime, "Prénom + Nom", secondResult || firstResult));
    return respond(res, secondResult || firstResult);
  }

  // --- Prénom seul ---
  if (hasA) {
    const r = await tryVortex(mergeFilters({ prenom: a }, filters));
    logToDiscord(buildLog(startTime, "Prénom", r));
    return respond(res, r);
  }

  // --- Nom seul ---
  if (hasB) {
    const r = await tryVortex(mergeFilters({ prenom: b }, filters));
    logToDiscord(buildLog(startTime, "Nom", r));
    return respond(res, r);
  }

  // --- Filtres seulement ---
  if (hasFilters) {
    const r = await tryVortex(mergeFilters({}, filters));
    logToDiscord(buildLog(startTime, "Filtres avancés", r));
    return respond(res, r);
  }

  logToDiscord(buildLog(startTime, "Aucune recherche", { ok: true, status: 200, data: [] }));
  return res.status(200).json(emptyResponse(a, b));
}
