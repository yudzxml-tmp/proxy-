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

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "bycf API aktif 🚀" });
});

// WAF session
app.post("/wafsession", async (req, res) => {
  const { url } = req.body || {};
  if (!url || !String(url).trim()) return res.status(400).json({ success: false, error: "url diperlukan" });
  const proxy = resolveProxy(req.body, req.headers);
  try {
    const session = proxy ? await cf.wafSession(url, proxy) : await cf.wafSession(url);
    return res.json({ success: true, data: session });
  } catch (err) {
    return respondError(res, err);
  }
});

// Turnstile - minimal (inject)
app.post("/turnstile-min", async (req, res) => {
  const { url, siteKey } = req.body || {};
  if (!url || !String(url).trim() || !siteKey || !String(siteKey).trim())
    return res.status(400).json({ success: false, error: "url & siteKey diperlukan" });

  const proxy = resolveProxy(req.body, req.headers);
  try {
    const token = proxy ? await cf.turnstileMin(url, siteKey, proxy) : await cf.turnstileMin(url, siteKey);
    return res.json({ success: true, token });
  } catch (err) {
    return respondError(res, err);
  }
});

// Turnstile - max (full simulation)
app.post("/turnstile-max", async (req, res) => {
  const { url } = req.body || {};
  if (!url || !String(url).trim()) return res.status(400).json({ success: false, error: "url diperlukan" });

  const proxy = resolveProxy(req.body, req.headers);
  try {
    const token = proxy ? await cf.turnstileMax(url, proxy) : await cf.turnstileMax(url);
    return res.json({ success: true, token });
  } catch (err) {
    return respondError(res, err);
  }
});

app.post("/source", async (req, res) => {
  const { url } = req.body || {};
  if (!url || !String(url).trim()) return res.status(400).json({ success: false, error: "url diperlukan" });

  const proxy = resolveProxy(req.body, req.headers);
  try {
    const html = proxy ? await cf.source(url, proxy) : await cf.source(url);
    return res.json({ success: true, html });
  } catch (err) {
    return respondError(res, err);
  }
});

// Stats
app.get("/stats", async (req, res) => {
  try {
    const stats = await cf.stats();
    return res.json({ success: true, stats });
  } catch (err) {
    return respondError(res, err);
  }
});

// small health check that returns which proxy will be used (if ada)
app.post("/probe", (req, res) => {
  const proxy = resolveProxy(req.body, req.headers);
  res.json({ success: true, proxy: proxy || null });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Endpoint tidak ditemukan" });
});

app.listen(PORT, () => {
  console.log(`⚡ bycf API aktif di port ${PORT}`);
  if (DEFAULT_PROXY) console.log(`⚡ Default proxy aktif: ${DEFAULT_PROXY}`);
});