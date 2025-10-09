const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer');
const express = require('express');

const app = express();
const COOKIE_FILE = path.resolve(__dirname, 'cookies.json');

// 🧁 Load cookies dari file
function loadCookies() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

// 💾 Simpan cookies baru
function saveCookies(domain, cookies) {
  const data = loadCookies();
  data[domain] = { cookies, updated: new Date().toISOString() };
  fs.writeFileSync(COOKIE_FILE, JSON.stringify(data, null, 2));
}

// 🍪 Ubah cookies ke format header
function cookieToHeader(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

// ✅ Cek validitas cookies
async function validateCookies(url, cookies) {
  try {
    const res = await axios.get(url, {
      headers: {
        Cookie: cookieToHeader(cookies),
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36',
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

// 🌐 Ambil cookies baru via Puppeteer (bypass Cloudflare)
async function fetchCfCookies(url, opts = {}) {
  const { timeout = 45000, waitInterval = 500, headless = true, userAgent = null } = opts;
  const browser = await puppeteer.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
    ],
    ignoreHTTPSErrors: true,
  });

  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      userAgent ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: new URL(url).origin,
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const start = Date.now();
    let cookies = [];

    while (Date.now() - start < timeout) {
      cookies = await page.cookies();
      const hasCf = cookies.some((c) =>
        ['__cf_bm', 'cf_clearance', '__cfduid'].includes(c.name)
      );
      const title = (await page.title()).toLowerCase();
      if (hasCf || !/just a moment|checking your browser/i.test(title)) break;
      await new Promise((r) => setTimeout(r, waitInterval));
    }

    await new Promise((r) => setTimeout(r, 500));
    const finalCookies = await page.cookies();
    await browser.close();
    return finalCookies;
  } catch (e) {
    await browser.close();
    throw new Error('Gagal ambil cookies Cloudflare: ' + e.message);
  }
}

// 🍪 Ambil cookies, cek cache dulu
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
    console.log('⚠️ Cookies expired, ambil ulang...');
  } else {
    console.log(`🔍 Tidak ada cookies tersimpan untuk ${domain}.`);
  }

  const freshCookies = await fetchCfCookies(url, opts);
  if (!freshCookies || freshCookies.length === 0)
    throw new Error('Tidak mendapatkan cookies dari Puppeteer');
  saveCookies(domain, freshCookies);
  console.log('✅ Cookies baru disimpan.');
  return freshCookies;
}

// 🚀 Endpoint tunggal: /cookies?url=
app.get('/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url)
    return res.status(400).json({ status: 400, error: 'Parameter ?url= wajib diisi' });

  try {
    const cookies = await getCookies(url);
    res.json({
      status: 200,
      domain: new URL(url).hostname,
      cookies,
      cookieHeader: cookieToHeader(cookies),
    });
  } catch (err) {
    console.error('❌ Gagal ambil cookies:', err.message);
    res.status(500).json({
      status: 500,
      error: 'Gagal mengambil cookies: ' + err.message,
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 200,
    author: 'Yudzxml',
    message: '✅ API aktif dan berjalan dengan baik.',
    timestamp: new Date().toISOString(),
  });
});

app.listen(8080, () => {
  console.log('🍪 Server cookie berjalan di port: 8080');
});