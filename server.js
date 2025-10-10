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

function resolveProxy(reqBody = {}, reqHeaders = {}) {
  if (reqBody.proxy && String(reqBody.proxy).trim()) return String(reqBody.proxy).trim();
  if (reqHeaders["x-proxy"] && String(reqHeaders["x-proxy"]).trim()) return String(reqHeaders["x-proxy"]).trim();
  if (DEFAULT_PROXY) return DEFAULT_PROXY;
  return null;
}

function respondError(res, err) {
  const message = err && err.message ? err.message : String(err);
  return res.status(500).json({ success: false, error: message });
}

// Helper untuk ambil param dari body atau query, sekaligus decode
function getParam(req, key) {
  const val = (req.body && req.body[key]) || (req.query && req.query[key]);
  return val ? decodeURIComponent(String(val)) : null;
}

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "bycf API aktif 🚀" });
});

// WAF session (POST & GET)
async function handleWafSession(req, res) {
  const url = getParam(req, "url");
  if (!url) return res.status(400).json({ success: false, error: "url diperlukan" });
  const proxy = resolveProxy(req.body || req.query, req.headers);
  try {
    const session = proxy ? await cf.wafSession(url, proxy) : await cf.wafSession(url);
    return res.json({ success: true, data: session });
  } catch (err) {
    return respondError(res, err);
  }
}
app.post("/wafsession", handleWafSession);
app.get("/wafsession", handleWafSession);

// Turnstile - minimal (POST & GET)
async function handleTurnstileMin(req, res) {
  const url = getParam(req, "url");
  const siteKey = getParam(req, "siteKey");
  if (!url || !siteKey)
    return res.status(400).json({ success: false, error: "url & siteKey diperlukan" });
  const proxy = resolveProxy(req.body || req.query, req.headers);
  try {
    const token = proxy ? await cf.turnstileMin(url, siteKey, proxy) : await cf.turnstileMin(url, siteKey);
    return res.json({ success: true, token });
  } catch (err) {
    return respondError(res, err);
  }
}
app.post("/turnstile-min", handleTurnstileMin);
app.get("/turnstile-min", handleTurnstileMin);

// Turnstile - max (POST & GET)
async function handleTurnstileMax(req, res) {
  const url = getParam(req, "url");
  if (!url) return res.status(400).json({ success: false, error: "url diperlukan" });
  const proxy = resolveProxy(req.body || req.query, req.headers);
  try {
    const token = proxy ? await cf.turnstileMax(url, proxy) : await cf.turnstileMax(url);
    return res.json({ success: true, token });
  } catch (err) {
    return respondError(res, err);
  }
}
app.post("/turnstile-max", handleTurnstileMax);
app.get("/turnstile-max", handleTurnstileMax);

// Source (POST & GET)
async function handleSource(req, res) {
  const url = getParam(req, "url");
  if (!url) return res.status(400).json({ success: false, error: "url diperlukan" });
  const proxy = resolveProxy(req.body || req.query, req.headers);
  try {
    const html = proxy ? await cf.source(url, proxy) : await cf.source(url);
    return res.json({ success: true, html });
  } catch (err) {
    return respondError(res, err);
  }
}
app.post("/source", handleSource);
app.get("/source", handleSource);

// Stats (GET only)
app.get("/stats", async (req, res) => {
  try {
    const stats = await cf.stats();
    return res.json({ success: true, stats });
  } catch (err) {
    return respondError(res, err);
  }
});

// Probe (POST & GET)
app.post("/probe", (req, res) => {
  const proxy = resolveProxy(req.body, req.headers);
  res.json({ success: true, proxy: proxy || null });
});
app.get("/probe", (req, res) => {
  const proxy = resolveProxy(req.query, req.headers);
  res.json({ success: true, proxy: proxy || null });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Endpoint tidak ditemukan" });
});

app.listen(PORT, () => {
  console.log(`⚡ bycf API aktif di port ${PORT}`);
  if (DEFAULT_PROXY) console.log(`⚡ Default proxy aktif: ${DEFAULT_PROXY}`);
});