const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { chromium } = require('playwright');
const express = require('express');
const app = express();

const COOKIE_FILE = path.resolve(__dirname, 'cookies.json');
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

function log(...msg) { console.log(`[${new Date().toLocaleTimeString()}]`, ...msg); }
function loadCookies() {
  try { if (fs.existsSync(COOKIE_FILE)) return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8')); }
  catch (e) { log('⚠️ Gagal load cookies:', e.message); }
  return {};
}
function saveCookies(domain, cookies) {
  const data = loadCookies(); data[domain] = { cookies, updated: new Date().toISOString() };
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2));
}
function cookieToHeader(cookies) { return cookies.map(c => `${c.name}=${c.value}`).join('; '); }

async function getValidCookies(url, proxy, headless = true, timeout = 90000) {
  log('🚀 Launching Chromium (headless:', headless + ')');
  const browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    proxy: proxy ? { server: proxy } : undefined
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  });
  const page = await context.newPage();
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });

  log('🌐 Membuka URL:', url);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout });
    await page.waitForTimeout(4000);
  } catch (e) {
    log('⚠️ Gagal memuat awal:', e.message);
  }

  let cfDetected = false;
  for (let i = 0; i < 20; i++) {
    const cookies = await context.cookies();
    const cf = cookies.find(c => c.name === 'cf_clearance');
    if (cf) { cfDetected = true; log('✅ cf_clearance terdeteksi'); break; }
    await page.waitForTimeout(1500);
  }

  const finalCookies = await context.cookies();
  await browser.close();
  if (!cfDetected) throw new Error('Cloudflare clearance tidak ditemukan');
  return finalCookies;
}

app.get('/proxy', async (req, res) => {
  const { url, proxy, headless } = req.query;
  if (!url) return res.status(400).json({ error: 'Parameter ?url= wajib diisi' });
  try {
    const domain = new URL(url).hostname;
    const cache = loadCookies();
    let cookies = cache[domain]?.cookies;
    const cookieHeader = cookies ? cookieToHeader(cookies) : null;

    if (cookies) {
      log('📂 Cookies cache ditemukan, validasi via axios...');
      try {
        const check = await axios.get(url, {
          headers: { Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000,
          validateStatus: s => s < 400
        });
        if (check.status < 400) {
          log('✅ Cookies masih valid');
          return res.json({ status: 200, domain, cookies, cookieHeader, message: '✅ Cache cookie masih valid' });
        }
      } catch (err) {
        log('❌ Cookie invalid, ambil ulang:', err.message);
      }
    }

    log('🔄 Mengambil cookie baru...');
    cookies = await getValidCookies(url, proxy, headless !== 'false');
    saveCookies(domain, cookies);
    res.json({
      status: 200,
      domain,
      cookies,
      cookieHeader: cookieToHeader(cookies),
      message: '✅ Cookies baru berhasil diambil'
    });
  } catch (err) {
    log('💥 Error GET /proxy:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/proxy', async (req, res) => {
  const { url, proxy, body, headers } = req.body;
  if (!url) return res.status(400).json({ error: 'Field "url" wajib' });
  try {
    const domain = new URL(url).hostname;
    let cookies = loadCookies()[domain]?.cookies;
    if (!cookies) {
      log('🔄 Tidak ada cookie cache, mengambil baru...');
      cookies = await getValidCookies(url, proxy);
      saveCookies(domain, cookies);
    }

    const cookieHeader = cookieToHeader(cookies);
    const response = await axios.post(url, body || {}, {
      headers: { ...headers, Cookie: cookieHeader, 'User-Agent': 'Mozilla/5.0' },
      timeout: 30000
    }).catch(async err => {
      if (err.response && err.response.status === 403) {
        log('🚫 Cookie invalid (403), mengambil ulang...');
        cookies = await getValidCookies(url, proxy);
        saveCookies(domain, cookies);
        const retry = await axios.post(url, body || {}, {
          headers: { ...headers, Cookie: cookieToHeader(cookies), 'User-Agent': 'Mozilla/5.0' },
          timeout: 30000
        });
        return retry;
      }
      throw err;
    });

    res.json({
      status: 200,
      domain,
      response: {
        status: response.status,
        headers: response.headers,
        body: typeof response.data === 'string' ? response.data.slice(0, 2000) : response.data
      }
    });
  } catch (err) {
    log('💥 Error POST /proxy:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.listen(8080, () => log('🍪 Server berjalan di port 8080'));