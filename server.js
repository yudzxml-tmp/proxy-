import express from "express";
import helmet from "helmet";
import cors from "cors";
import { shannz as cf } from "bycf";

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const PORT = process.env.PORT || 8080;
const DEFAULT_PROXY = process.env.DEFAULT_PROXY || "";

// Helper: aman ambil proxy
function resolveProxy(reqBody = {}, reqHeaders = {}) {
  try {
    if (reqBody.proxy && String(reqBody.proxy).trim()) return String(reqBody.proxy).trim();
    if (reqHeaders["x-proxy"] && String(reqHeaders["x-proxy"]).trim())
      return String(reqHeaders["x-proxy"]).trim();
    if (DEFAULT_PROXY) return DEFAULT_PROXY;
    return null;
  } catch {
    return null;
  }
}

// Helper error JSON aman
function respondError(res, err) {
  let message = "Terjadi kesalahan tidak diketahui";
  if (err) {
    if (err.message) message = err.message;
    else if (typeof err === "string") message = err;
    else message = JSON.stringify(err);
  }
  res.setHeader("Content-Type", "application/json");
  return res.status(500).json({ success: false, error: message });
}

// Helper: ambil & decode param
function getParam(req, key) {
  try {
    const val = (req.body && req.body[key]) || (req.query && req.query[key]);
    return val ? decodeURIComponent(String(val)) : null;
  } catch {
    return null;
  }
}

// Validator URL sederhana
function isValidUrl(str) {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

// Healthcheck
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "bycf API aktif 🚀" });
});

// ===== HANDLERS =====

// WAF session
async function handleWafSession(req, res) {
  const url = getParam(req, "url");
  if (!url || !isValidUrl(url))
    return res.status(400).json({ success: false, error: "url tidak valid" });
  const proxy = resolveProxy(req.body || req.query, req.headers);
  try {
    const session = proxy ? await cf.wafSession(url, proxy) : await cf.wafSession(url);
    res.json({ success: true, data: safeJson(session) });
  } catch (err) {
    respondError(res, err);
  }
}
app.post("/wafsession", handleWafSession);
app.get("/wafsession", handleWafSession);

// Turnstile-min
async function handleTurnstileMin(req, res) {
  const url = getParam(req, "url");
  const siteKey = getParam(req, "siteKey");
  if (!url || !isValidUrl(url) || !siteKey)
    return res.status(400).json({ success: false, error: "url & siteKey diperlukan" });
  const proxy = resolveProxy(req.body || req.query, req.headers);
  try {
    const token = proxy
      ? await cf.turnstileMin(url, siteKey, proxy)
      : await cf.turnstileMin(url, siteKey);
    res.json({ success: true, token: safeJson(token) });
  } catch (err) {
    respondError(res, err);
  }
}
app.post("/turnstile-min", handleTurnstileMin);
app.get("/turnstile-min", handleTurnstileMin);

// Turnstile-max
async function handleTurnstileMax(req, res) {
  const url = getParam(req, "url");
  if (!url || !isValidUrl(url))
    return res.status(400).json({ success: false, error: "url tidak valid" });
  const proxy = resolveProxy(req.body || req.query, req.headers);
  try {
    const token = proxy ? await cf.turnstileMax(url, proxy) : await cf.turnstileMax(url);
    res.json({ success: true, token: safeJson(token) });
  } catch (err) {
    respondError(res, err);
  }
}
app.post("/turnstile-max", handleTurnstileMax);
app.get("/turnstile-max", handleTurnstileMax);

// Source
async function handleSource(req, res) {
  const url = getParam(req, "url");
  if (!url || !isValidUrl(url))
    return res.status(400).json({ success: false, error: "url tidak valid" });
  const proxy = resolveProxy(req.body || req.query, req.headers);
  try {
    let html = proxy ? await cf.source(url, proxy) : await cf.source(url);

    // Antisipasi respon bukan string
    if (typeof html !== "string") html = JSON.stringify(html);
    res.json({ success: true, html });
  } catch (err) {
    respondError(res, err);
  }
}
app.post("/source", handleSource);
app.get("/source", handleSource);

// Stats
app.get("/stats", async (req, res) => {
  try {
    const stats = await cf.stats();
    res.json({ success: true, stats: safeJson(stats) });
  } catch (err) {
    respondError(res, err);
  }
});

// Probe
app.all("/probe", (req, res) => {
  const proxy = resolveProxy(req.body || req.query, req.headers);
  res.json({ success: true, proxy: proxy || null });
});

// Fallback 404
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Endpoint tidak ditemukan" });
});

// Fungsi pelindung JSON biar tidak crash
function safeJson(data) {
  try {
    if (typeof data === "string") {
      JSON.parse(data);
      return JSON.parse(data);
    }
    return data;
  } catch {
    return data; // kalau bukan JSON valid, kirim apa adanya
  }
}

// Jalankan server
app.listen(PORT, () => {
  console.log(`⚡ bycf API aktif di port ${PORT}`);
  if (DEFAULT_PROXY) console.log(`⚡ Default proxy aktif: ${DEFAULT_PROXY}`);
});
