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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
      },
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
      timeout: 15000,
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
  const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--single-process', '--disable-gpu', ...extraArgs];
  if (parsedProxy) {
    const proxyArg = parsedProxy.proto && parsedProxy.proto.length > 0 ? `${parsedProxy.proto}${parsedProxy.hostPort}` : parsedProxy.hostPort;
    args.push(`--proxy-server=${proxyArg}`);
    console.log(`🌐 [fetchCfCookies] using proxy arg: ${proxyArg}`);
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
        try {
          await page.authenticate({ username, password });
          console.log('🔐 Proxy authentication applied');
        } catch (e) {
          console.warn('⚠️ Gagal set proxy auth:', e.message);
        }
      }
    }
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => console.warn('goto warning:', e.message));
    const start = Date.now();
    let cookies = [];
    let lastLog = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (Date.now() - lastLog > 15000) {
          try {
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
            lastLog = Date.now();
          } catch {}
        }
      } catch {}
      cookies = await page.cookies().catch(() => []);
      const hasCf = cookies.some((c) => ['__cf_bm', 'cf_clearance', '__cfduid', 'cf_chl_2', 'cf_chl_prog'].includes(c.name));
      const iframes = await page.$$eval('iframe', (els) => els.map((f) => f.src || '').filter(Boolean)).catch(() => []);
      const hasTurnstileIframe = iframes.some((s) => /turnstile|challenges.cloudflare|cloudflare.com/.test(s));
      const title = (await page.title().catch(() => '')).toLowerCase();
      if (Date.now() - start < 5000) console.log('⏳ initial check:', { hasCf, hasTurnstileIframe, titleSnippet: title.slice(0, 60) });
      else if (hasCf) console.log('✅ Detected CF cookie(s) while waiting.');
      else if (hasTurnstileIframe) console.log('🧩 Turnstile/CF challenge iframe detected, waiting longer...');
      if (hasCf) break;
      if (!/just a moment|checking your browser|please wait/i.test(title) && !hasTurnstileIframe) break;
      await new Promise((r) => setTimeout(r, waitInterval));
    }
    await new Promise((r) => setTimeout(r, 750));
    const finalCookies = await page.cookies().catch(() => []);
    await browser.close();
    if (!finalCookies || finalCookies.length === 0) throw new Error('Tidak mendapatkan cookies dari Puppeteer (akhir proses).');
    return finalCookies;
  } catch (e) {
    try {
      await browser.close();
    } catch {}
    throw new Error('Gagal ambil cookies Cloudflare: ' + e.message);
  }
}

async function getCookies(url, opts = {}) {
  const domain = new URL(url).hostname;
  const cache = loadCookies();
  const cached = cache[domain]?.cookies;
  if (cached) {
    console.log(`🍪 Ditemukan cookies lama untuk ${domain}, cek validitas...`);
    const valid = await validateCookies(url, cached);
    if (valid) {
      console.log('✅ Cookies masih valid, pakai cache.');
      return cached;
    }
    console.log('⚠️ Cookies expired atau tidak valid, ambil ulang...');
  } else {
    console.log(`🔍 Tidak ada cookies tersimpan untuk ${domain}.`);
  }
  const freshCookies = await fetchCfCookies(url, opts);
  if (!freshCookies || freshCookies.length === 0) throw new Error('Tidak mendapatkan cookies dari Puppeteer');
  saveCookies(domain, freshCookies);
  console.log('✅ Cookies baru disimpan.');
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
    userAgent: userAgent || undefined,
  };
  try {
    const cookies = await getCookies(url, opts);
    res.json({
      status: 200,
      domain: new URL(url).hostname,
      proxy: proxy || 'none',
      cookies,
      cookieHeader: cookieToHeader(cookies),
      usedOptions: opts,
    });
  } catch (err) {
    console.error('❌ Gagal ambil cookies:', err.message);
    res.status(500).json({ status: 500, error: 'Gagal mengambil cookies: ' + err.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 200, author: 'Yudzxml', message: '✅ API aktif dan berjalan dengan baik.', timestamp: new Date().toISOString() });
});

app.listen(8080, () => console.log('🍪 Server cookie berjalan di port: 8080'));