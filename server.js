const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');
const express = require('express');

const app = express();
const COOKIE_FILE = path.resolve(__dirname, 'cookies.json');

function log(...msg) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...msg);
}

function loadCookies() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      log('🔹 Memuat cookies dari file lokal');
      return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    }
  } catch (e) {
    log('⚠️ Gagal memuat cookies:', e.message);
  }
  return {};
}

function saveCookies(domain, cookies) {
  log('💾 Menyimpan cookies untuk domain:', domain);
  const data = loadCookies();
  data[domain] = { cookies, updated: new Date().toISOString() };
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2));
}

function cookieToHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

async function validateCookies(url, cookies) {
  log('🔍 Memvalidasi cookies ke:', url);
  try {
    const res = await axios.get(url, {
      headers: {
        Cookie: cookieToHeader(cookies),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122 Safari/537.36'
      },
      maxRedirects: 0,
      validateStatus: (s) => s < 400,
      timeout: 15000
    });
    log('✅ Validasi cookies:', res.status);
    return res.status < 400;
  } catch (e) {
    log('❌ Validasi gagal:', e.message);
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
  log('🌐 Proxy terdeteksi:', proxy);
  return { original: proxy, proto, creds, hostPort };
}

async function fetchCfCookiesPlaywright(url, opts = {}) {
  const {
    timeout = 120000,
    waitInterval = 800,
    headless = true,
    userAgent = null,
    proxy = null,
    viewport = { width: 1366, height: 768 },
    extraArgs = []
  } = opts;

  const parsedProxy = normalizeProxy(proxy);
  log('🚀 Meluncurkan Playwright Browser (headless:', headless, ')');

  const launchOptions = {
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      ...extraArgs
    ],
    ignoreDefaultArgs: ['--enable-automation']
  };

  if (parsedProxy && parsedProxy.hostPort) {
    const server = parsedProxy.proto && parsedProxy.proto.length > 0
      ? `${parsedProxy.proto}${parsedProxy.hostPort}`
      : parsedProxy.hostPort;
    launchOptions.proxy = { server };
    log('🧭 Menggunakan proxy:', server);
  }

  const browser = await chromium.launch(launchOptions);

  try {
    const contextOptions = {
      viewport,
      userAgent: userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
      locale: 'id-ID'
    };

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    log('📄 Membuka halaman:', url);

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      try { Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] }); } catch (e) {}
    });

    await page.setExtraHTTPHeaders({
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: new URL(url).origin
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      log('🌍 Halaman dimuat, memulai pemantauan cookies...');
    } catch (e) {
      log('⚠️ Gagal memuat halaman:', e.message);
    }

    const start = Date.now();
    let collectedCookies = [];

    while (Date.now() - start < timeout) {
      const cookiesNow = await context.cookies().catch(() => []);
      const hasCf = cookiesNow.some((c) => ['__cf_bm', 'cf_clearance', '__cfduid'].includes(c.name));
      if (hasCf) {
        collectedCookies = cookiesNow;
        log('🍪 Cookies Cloudflare ditemukan!');
        break;
      }

      const frames = page.frames();
      let handled = false;
      for (const f of frames) {
        const fUrl = f.url() || '';
        if (fUrl.includes('turnstile') || fUrl.includes('challenges.cloudflare.com') || fUrl.includes('challenge')) {
          log('🧩 Deteksi challenge Cloudflare di:', fUrl);
          try {
            const btn = await f.$('button, input[type="checkbox"], div[role="button"], iframe');
            if (btn) {
              log('🤖 Mencoba klik tombol verifikasi...');
              await btn.click({ delay: 100 }).catch(() => {});
              handled = true;
            }
          } catch (err) {
            log('❌ Gagal klik challenge:', err.message);
          }
        }
        if (handled) break;
      }

      await page.mouse.move(100 + Math.random() * 400, 100 + Math.random() * 400, { steps: 8 }).catch(() => {});
      await new Promise((r) => setTimeout(r, waitInterval));
    }

    await page.waitForTimeout(1000).catch(() => {});
    const finalCookies = await context.cookies().catch(() => []);
    log('📦 Total cookies terkumpul:', finalCookies.length);

    await context.close();
    await browser.close();

    if (!finalCookies || finalCookies.length === 0) throw new Error('Tidak mendapatkan cookies dari Playwright');

    const norm = finalCookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure
    }));

    log('✅ Pengambilan cookies berhasil');
    return norm;
  } catch (e) {
    log('❌ Gagal ambil cookies:', e.message);
    try { await browser.close(); } catch {}
    throw new Error('Gagal ambil cookies Playwright: ' + (e && e.message ? e.message : e));
  }
}

async function getCookies(url, opts = {}) {
  const domain = new URL(url).hostname;
  log('🔸 Proses pengambilan cookies untuk:', domain);
  const cache = loadCookies();
  const cached = cache[domain]?.cookies;
  if (cached) {
    log('📂 Cookies ditemukan di cache, memvalidasi...');
    const valid = await validateCookies(url, cached);
    if (valid) {
      log('✅ Cookies cache masih valid');
      return cached;
    } else {
      log('🧹 Cookies cache tidak valid, mengambil baru...');
    }
  } else {
    log('📭 Tidak ada cookies cache, mengambil baru...');
  }

  const freshCookies = await fetchCfCookiesPlaywright(url, opts);
  if (!freshCookies || freshCookies.length === 0) throw new Error('Tidak mendapatkan cookies dari Playwright');
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
  log('⚙️ Memulai proses /proxy dengan opsi:', opts);
  try {
    const cookies = await getCookies(url, opts);
    log('🎉 Proses selesai, mengirim hasil JSON');
    res.json({
      status: 200,
      domain: new URL(url).hostname,
      proxy: proxy || 'none',
      cookies,
      cookieHeader: cookieToHeader(cookies),
      usedOptions: opts
    });
  } catch (err) {
    log('💥 Gagal dalam endpoint /proxy:', err.message);
    res.status(500).json({ status: 500, error: 'Gagal mengambil cookies: ' + err.message });
  }
});

app.get('/', (req, res) => {
  log('📡 Akses ke endpoint utama');
  res.json({ status: 200, author: 'Yudzxml', message: '✅ API aktif dan berjalan dengan baik.', timestamp: new Date().toISOString() });
});

app.listen(8080, () => log('🍪 Server cookie (Playwright) berjalan di port: 8080'));