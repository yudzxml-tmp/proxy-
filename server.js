const fs = require('fs');
const path = require('path');
const axios = require('axios');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const express = require('express');

puppeteer.use(StealthPlugin());
const app = express();
const COOKIE_FILE = path.resolve(__dirname, 'cookies.json');

function loadCookies() {
  try {
    if (fs.existsSync(COOKIE_FILE)) {
      return JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf-8'));
    }
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
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

async function randomHumanMouse(page, duration = 2000) {
  const viewport = page.viewport() || { width: 1200, height: 800 };
  const end = Date.now() + duration;
  let prev = { x: Math.floor(viewport.width / 2), y: Math.floor(viewport.height / 2) };
  try {
    await page.mouse.move(prev.x, prev.y);
    while (Date.now() < end) {
      const nx = Math.max(1, Math.min(viewport.width - 1, prev.x + Math.floor((Math.random() - 0.5) * 200)));
      const ny = Math.max(1, Math.min(viewport.height - 1, prev.y + Math.floor((Math.random() - 0.5) * 120)));
      await page.mouse.move(nx, ny, { steps: Math.floor(5 + Math.random() * 10) });
      prev = { x: nx, y: ny };
      await page.waitForTimeout(150 + Math.floor(Math.random() * 300));
    }
  } catch (e) {}
}

async function fetchCfCookies(url, opts = {}) {
  const {
    timeout = 60000,
    waitInterval = 700,
    headless = true,
    userAgent = null,
    allowManual = false
  } = opts;

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
      '--disable-gpu'
    ],
    ignoreHTTPSErrors: true
  });

  const page = await browser.newPage();
  try {
    await page.setUserAgent(
      userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36'
    );
    await page.setExtraHTTPHeaders({
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      referer: new URL(url).origin
    });
    await page.setViewport({ width: 1200, height: 800 });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const start = Date.now();
    let cookies = [];

    while (Date.now() - start < timeout) {
      cookies = await page.cookies();
      const hasCfCookie = cookies.some((c) => ['__cf_bm', 'cf_clearance', '__cfduid'].includes(c.name));
      const title = (await page.title()).toLowerCase();
      const hasTurnstileIframe = await page.$("iframe[src*='turnstile'], iframe[src*='cloudflare.com']");
      if (hasCfCookie) break;
      if (!/just a moment|checking your browser/i.test(title) && !hasTurnstileIframe) break;

      if (hasTurnstileIframe) {
        try {
          await randomHumanMouse(page, 1500);
        } catch (e) {}
        const frameHandles = await page.$$("iframe");
        for (const fh of frameHandles) {
          try {
            const src = await (await fh.getProperty('src')).jsonValue();
            if (src && /turnstile/i.test(src)) {
              try {
                await fh.waitForSelector('iframe', { timeout: 500 }).catch(() => {});
              } catch (e) {}
            }
          } catch (e) {}
        }
      }

      await page.waitForTimeout(waitInterval);
    }

    await page.waitForTimeout(800);
    const finalCookies = await page.cookies();
    await browser.close();
    return finalCookies;
  } catch (e) {
    await browser.close();
    if (e.message && /timeout/i.test(e.message) && allowManual === true) {
      throw new Error('TIMEOUT_WAIT_MANUAL');
    }
    throw new Error('Gagal ambil cookies Cloudflare: ' + (e.message || e));
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
  const { url, headless } = req.query;
  if (!url) return res.status(400).json({ status: 400, error: 'Parameter ?url= wajib diisi' });

  const opts = { headless: headless !== 'false' };
  try {
    const cookies = await getCookies(url, opts);
    res.json({
      status: 200,
      domain: new URL(url).hostname,
      cookies,
      cookieHeader: cookieToHeader(cookies)
    });
  } catch (err) {
    const message = err.message === 'TIMEOUT_WAIT_MANUAL'
      ? 'Timeout saat menunggu challenge; coba ulang dengan ?headless=false untuk melihat challenge secara manual.'
      : 'Gagal mengambil cookies: ' + (err.message || err);
    res.status(500).json({ status: 500, error: message });
  }
});

app.get('/', (req, res) => {
  res.json({
    status: 200,
    author: 'Yudzxml',
    message: 'API aktif dan berjalan dengan baik.',
    timestamp: new Date().toISOString()
  });
});

app.listen(8080, () => {
  console.log('Server cookie berjalan di port: 8080');
});