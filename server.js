import express from "express";
import helmet from "helmet";
import cors from "cors";
import { shannz as cf } from "bycf";
import { chromium } from "@divriots/playwright-extra";
import stealth from "playwright-extra-plugin-stealth";
import userAgents from "user-agents";

chromium.use(stealth());

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
  const message = err?.message || String(err);
  return res.status(500).json({ success: false, error: message });
}

function getRandomUserAgent() {
  try {
    return new userAgents().toString();
  } catch {
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
  }
}

const preloadScript = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = params => params.name === 'notifications' ? Promise.resolve({ state: Notification.permission }) : originalQuery(params);
window.chrome = { runtime: {} };
`;

async function fetchWithRetries(page, url, options = {}) {
  const { attempts = 2, waitUntil = "networkidle", timeout = 45000, waitForSelector } = options;
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(url, { waitUntil, timeout });
      if (waitForSelector) await page.waitForSelector(waitForSelector, { timeout: Math.max(5000, timeout / 3) });
      else await page.waitForTimeout(500);
      return { success: true, html: await page.content() };
    } catch (err) {
      lastErr = err;
      await page.waitForTimeout(500 + i * 500);
    }
  }
  return { success: false, error: lastErr };
}

// ====== API BASIC ======
app.get("/", (req, res) => res.json({ status: "ok", message: "bycf API aktif 🚀" }));

app.post("/wafsession", async (req, res) => {
  const { url } = req.body || {};
  if (!url?.trim()) return res.status(400).json({ success: false, error: "url diperlukan" });
  const proxy = resolveProxy(req.body, req.headers);
  try {
    const session = proxy ? await cf.wafSession(url, proxy) : await cf.wafSession(url);
    res.json({ success: true, data: session });
  } catch (err) { respondError(res, err); }
});

app.post("/turnstile-min", async (req, res) => {
  const { url, siteKey } = req.body || {};
  if (!url?.trim() || !siteKey?.trim()) return res.status(400).json({ success: false, error: "url & siteKey diperlukan" });
  const proxy = resolveProxy(req.body, req.headers);
  try { 
    const token = proxy ? await cf.turnstileMin(url, siteKey, proxy) : await cf.turnstileMin(url, siteKey); 
    res.json({ success: true, token }); 
  } catch (err) { respondError(res, err); }
});

app.post("/turnstile-max", async (req, res) => {
  const { url } = req.body || {};
  if (!url?.trim()) return res.status(400).json({ success: false, error: "url diperlukan" });
  const proxy = resolveProxy(req.body, req.headers);
  try { 
    const token = proxy ? await cf.turnstileMax(url, proxy) : await cf.turnstileMax(url); 
    res.json({ success: true, token }); 
  } catch (err) { respondError(res, err); }
});

app.post("/source", async (req, res) => {
  const { url } = req.body || {};
  if (!url?.trim()) return res.status(400).json({ success: false, error: "url diperlukan" });
  const proxy = resolveProxy(req.body, req.headers);
  try { 
    const html = proxy ? await cf.source(url, proxy) : await cf.source(url); 
    res.json({ success: true, html }); 
  } catch (err) { respondError(res, err); }
});

app.get("/stats", async (req, res) => { 
  try { 
    const stats = await cf.stats(); 
    res.json({ success: true, stats }); 
  } catch (err) { respondError(res, err); } 
});

app.post("/probe", (req, res) => { 
  const proxy = resolveProxy(req.body, req.headers); 
  res.json({ success: true, proxy: proxy || null }); 
});

// ====== PLAYWRIGHT ======
async function launchBrowser(proxy, ua) {
  return chromium.launch({ 
    headless: true, 
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled"
    ], 
    proxy: proxy ? { server: proxy } : undefined 
  });
}

app.get("/api/getsource", async (req, res) => {
  const { url, proxy, selector, ua } = req.query;
  if (!url) return res.status(400).json({ success: false, message: "URL diperlukan" });
  let browser;
  try {
    browser = await launchBrowser(proxy, ua);
    const context = await browser.newContext({ 
      userAgent: ua || getRandomUserAgent(), 
      viewport: { width: 1366, height: 768 }, 
      locale: "en-US" 
    });
    await context.addInitScript({ content: preloadScript });
    const page = await context.newPage();
    const result = await fetchWithRetries(page, url, { attempts: 3, waitUntil: "networkidle", timeout: 45000, waitForSelector: selector });
    if (!result.success) throw new Error(result.error?.message || "Unknown error");
    res.json({ success: true, url: page.url(), html: result.html });
    await browser.close();
  } catch (err) { 
    if (browser) await browser.close(); 
    respondError(res, err); 
  }
});

app.get("/api/getcookies", async (req, res) => {
  const { url, proxy, ua } = req.query;
  if (!url) return res.status(400).json({ success: false, message: "URL diperlukan" });
  let browser;
  try {
    browser = await launchBrowser(proxy, ua);
    const context = await browser.newContext({ userAgent: ua || getRandomUserAgent(), viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    const cookies = await context.cookies();
    res.json({ success: true, cookies });
    await browser.close();
  } catch (err) { 
    if (browser) await browser.close(); 
    respondError(res, err); 
  }
});

// ====== SCREENSHOT ======
app.get("/api/screenshot", async (req, res) => {
  const { url, device = "desktop", proxy } = req.query;

  if (!url) return res.status(400).json({ success: false, message: "URL diperlukan" });

  let browser;
  try {
    let viewport = { width: 1366, height: 768 };
    let ua = getRandomUserAgent();

    switch (device.toLowerCase()) {
      case "phone":
        viewport = { width: 375, height: 812 };
        ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1";
        break;
      case "tablet":
        viewport = { width: 768, height: 1024 };
        ua = "Mozilla/5.0 (iPad; CPU OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1";
        break;
    }

    browser = await launchBrowser(proxy, ua);
    const context = await browser.newContext({ userAgent: ua, viewport });
    await context.addInitScript({ content: preloadScript });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });

    const buffer = await page.screenshot({ fullPage: true });
    res.setHeader("Content-Type", "image/png");
    res.send(buffer);

    await browser.close();
  } catch (err) {
    if (browser) await browser.close();
    respondError(res, err);
  }
});

app.use((req, res) => res.status(404).json({ success: false, error: "Endpoint tidak ditemukan" }));

app.listen(PORT, () => {
  console.log(`⚡ bycf API aktif di port ${PORT}`);
  if (DEFAULT_PROXY) console.log(`⚡ Default proxy aktif: ${DEFAULT_PROXY}`);
});