const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer');
const express = require('express');

const app = express();
const COOKIE_FILE = path.resolve(__dirname, 'cookies.json');

function loadCookies() {
  try {
    if (fs.existsSync(COOKIE_FILE)) return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
  } catch {}
  return {};
}

function saveCookies(domain, cookies) {
  const data = loadCookies();
  data[domain] = { cookies, updated: new Date().toISOString() };
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2));
}

function cookieToHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function validateCookies(url, cookies) {
  try {
    const res = await axios.get(url, {
      headers: {
        Cookie: cookieToHeader(cookies),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36'
      },
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
      timeout: 15000
    });
    return res.status < 400;
  } catch {
    return false;
  }
}

function normalizeProxy(proxy) {
  if (!proxy) return null;
  let proto = '';
  let p = proxy;
  if (proxy.startsWith('http://') || proxy.startsWith('https://') || proxy.startsWith('socks5://')) {
    const idx = proxy.indexOf('://');
    proto = proxy.slice(0, idx + 3);
    p = proxy.slice(idx + 3);
  }
  let creds = null;
  let hostPort = p;
  if (p.includes('@')) {
    const [c, hp] = p.split('@');
    creds = c;
    hostPort = hp;
  }
  return { original: proxy, proto, creds, hostPort };
}

async function fetchCfCookies(url, opts = {}) {
  const { timeout = 120000, waitInterval = 800, headless = true, userAgent = null, proxy = null, viewport = { width: 1366, height: 768 }, extraArgs = [] } = opts;
  const parsedProxy = normalizeProxy(proxy);
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process', ...extraArgs];
  if (parsedProxy) {
    const proxyArg = parsedProxy.proto && parsedProxy.proto.length > 0 ? `${parsedProxy.proto}${parsedProxy.hostPort}` : parsedProxy.hostPort;
    args.push(`--proxy-server=${proxyArg}`);
  }
  const browser = await puppeteer.launch({ headless, args, ignoreHTTPSErrors: true });
  const page = await browser.newPage();
  try {
    await page.setViewport(viewport);
    await page.setUserAgent(userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7', referer: new URL(url).origin });
    if (parsedProxy && parsedProxy.creds) {
      const [username, password] = parsedProxy.creds.split(':');
      if (username) {
        try { await page.authenticate({ username, password }); } catch {}
      }
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    const start = Date.now();
    let cookies = [];
    while (Date.now() - start < timeout) {
      cookies = await page.cookies().catch(() => []);
      const hasCf = cookies.some((c) => ['__cf_bm', 'cf_clearance', '__cfduid'].includes(c.name));
      if (hasCf) break;
      const challengeFrame = await page.$('iframe[src*="turnstile"], iframe[src*="challenges.cloudflare.com"]');
      if (challengeFrame) {
        const frame = await challengeFrame.contentFrame();
        if (frame) {
          const checkbox = await frame.$('input[type="checkbox"]');
          if (checkbox) await checkbox.click().catch(() => {});
        }
      }
      const title = (await page.title().catch(() => '')).toLowerCase();
      if (!/just a moment|checking your browser|please wait|verify you are human/.test(title)) break;
      await new Promise((r) => setTimeout(r, waitInterval));
    }
    await new Promise((r) => setTimeout(r, 1000));
    const finalCookies = await page.cookies().catch(() => []);
    await browser.close();
    if (!finalCookies || finalCookies.length === 0) throw new Error('Tidak mendapatkan cookies dari Puppeteer');
    return finalCookies;
  } catch (e) {
    try { await browser.close(); } catch {}
    throw new Error('Gagal ambil cookies Cloudflare: ' + e.message);
  }
}

async function getCookies(url, opts = {}) {
  const domain = new URL(url).hostname;
  const cache = loadCookies();
  const cached = cache[domain]?.cookies;
  if (cached) {
    const valid = await validateCookies(url, cached);
    if (valid) return cached;
  }
  const freshCookies = await fetchCfCookies(url, opts);
  if (!freshCookies || freshCookies.length === 0) throw new Error('Tidak mendapatkan cookies dari Puppeteer');
  saveCookies(domain, freshCookies);
  return freshCookies;
}

app.get('/proxy', async (req, res) => {
  const { url, proxy, headless, timeout, waitInterval, userAgent } = req.query;
  if (!url) return res.status(400).json({ status: 400, error: 'Parameter ?url= wajib diisi' });
  const opts = {
    proxy: proxy || null,
    headless: headless === 'false' ? false : true,
    timeout: timeout ? parseInt(timeout, 10) : undefined,
    waitInterval: waitInterval ? parseInt(waitInterval, 10) : undefined,
    userAgent: userAgent || undefined
  };
  try {
    const cookies = await getCookies(url, opts);
    res.json({
      status: 200,
      domain: new URL(url).hostname,
      proxy: proxy || 'none',
      cookies,
      cookieHeader: cookieToHeader(cookies),
      usedOptions: opts
    });
  } catch (err) {
    res.status(500).json({ status: 500, error: 'Gagal mengambil cookies: ' + err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 200, author: 'Yudzxml', message: '✅ API aktif dan berjalan dengan baik.', timestamp: new Date().toISOString() });
});

app.listen(8080, () => console.log('🍪 Server cookie berjalan di port: 8080'));