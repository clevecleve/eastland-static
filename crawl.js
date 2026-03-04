#!/usr/bin/env node
/**
 * crawl.js — Playwright-based static site crawler
 *
 * Visits every page on the site, slow-scrolls to trigger lazy loading,
 * saves fully-rendered HTML, then downloads same-origin CSS/JS/font/image assets.
 *
 * Usage:  node crawl.js
 * Env:    CRAWL_ORIGIN   (default: https://eastland.qicre.com)
 *         CRAWL_OUT_DIR  (default: ./dist)
 */

const { chromium } = require('playwright');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const ORIGIN = (process.env.CRAWL_ORIGIN || 'https://eastland.qicre.com').replace(/\/$/, '');
const OUT_DIR = process.env.CRAWL_OUT_DIR || path.join(__dirname, 'dist');
const originUrl = new URL(ORIGIN);

// Paths that should not be followed as pages
const EXCLUDED_PATH_PREFIXES = [
  '/api/',
  '/sitecore/',
  '/-/',
  '/App_Themes/',
  '/App_Config/',
  '/cdn-cgi/',
  '/~/media/',
  '/~/icon/',
];

const EXCLUDED_EXTENSIONS = new Set([
  '.json', '.xml', '.rss', '.atom', '.csv',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip',
]);

// Asset extensions we want to download
const ASSET_EXTENSIONS = new Set([
  '.css', '.js', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.avif',
  '.mp4', // include if small enough; will skip in download if huge
]);

const visited = new Set();
const queue = [];
const assetQueue = new Set();
const downloadedAssets = new Set();

// ─── URL helpers ─────────────────────────────────────────────────────────────

function isExcluded(pathname) {
  for (const prefix of EXCLUDED_PATH_PREFIXES) {
    if (pathname.toLowerCase().startsWith(prefix)) return true;
  }
  const ext = path.extname(pathname).toLowerCase();
  if (EXCLUDED_EXTENSIONS.has(ext)) return true;
  return false;
}

function normalizePageUrl(href, base) {
  if (!href) return null;
  href = href.trim();
  if (
    href.startsWith('#') ||
    href.startsWith('mailto:') ||
    href.startsWith('tel:') ||
    href.startsWith('javascript:') ||
    href.startsWith('data:')
  ) return null;

  try {
    const u = new URL(href, base);
    if (u.origin !== originUrl.origin) return null;

    let pathname = u.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }

    if (isExcluded(pathname)) return null;

    return originUrl.origin + pathname;
  } catch {
    return null;
  }
}

function urlToFilePath(pageUrl) {
  const u = new URL(pageUrl);
  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  if (pathname === '/') return path.join(OUT_DIR, 'index.html');

  const ext = path.extname(pathname).toLowerCase();
  if (ext === '.html' || ext === '.htm') return path.join(OUT_DIR, pathname);

  // Treat as a directory → index.html
  return path.join(OUT_DIR, pathname, 'index.html');
}

function assetUrlToLocalPath(assetUrl) {
  try {
    const u = new URL(assetUrl);
    if (u.origin !== originUrl.origin) return null;
    return path.join(OUT_DIR, u.pathname);
  } catch {
    return null;
  }
}

// ─── Asset downloader ────────────────────────────────────────────────────────

async function downloadFile(fileUrl, dest) {
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  return new Promise((resolve) => {
    const mod = fileUrl.startsWith('https') ? https : http;
    const req = mod.get(
      fileUrl,
      { headers: { 'User-Agent': 'Mozilla/5.0 StaticCrawler/1.0' } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirect = new URL(res.headers.location, fileUrl).href;
          downloadFile(redirect, dest).then(resolve);
          return;
        }
        if (res.statusCode !== 200) {
          resolve();
          return;
        }
        const stream = fs.createWriteStream(dest);
        res.pipe(stream);
        stream.on('finish', resolve);
        stream.on('error', () => resolve());
      }
    );
    req.on('error', () => resolve());
    req.setTimeout(30000, () => { req.destroy(); resolve(); });
  });
}

// ─── Scrolling ───────────────────────────────────────────────────────────────

async function scrollToLoadAll(page, isDirectory) {
  const stepPx = isDirectory ? 350 : 700;
  const stepDelayMs = isDirectory ? 450 : 120;
  const stableThreshold = isDirectory ? 6 : 2;

  let lastHeight = 0;
  let stableCount = 0;
  let scrollY = 0;

  console.log(`  Scrolling${isDirectory ? ' (slow — directory page)' : ''}…`);

  while (stableCount < stableThreshold) {
    scrollY += stepPx;
    await page.evaluate((y) => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(stepDelayMs);

    const [currentScrollHeight, innerH] = await page.evaluate(() => [
      document.body.scrollHeight,
      window.innerHeight,
    ]);

    if (scrollY + innerH >= currentScrollHeight - 50) {
      // We're at (or past) the bottom
      if (currentScrollHeight === lastHeight) {
        stableCount++;
      } else {
        stableCount = 0;
        lastHeight = currentScrollHeight;
      }

      if (stableCount < stableThreshold) {
        // Wait for lazy-loaded content to arrive
        await page.waitForTimeout(isDirectory ? 900 : 300);
      }

      scrollY = currentScrollHeight - innerH; // reset to real bottom
    }
  }

  // Scroll back to top so the saved HTML reflects the default page state
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
}

// ─── Link / asset extraction ─────────────────────────────────────────────────

function extractLinksAndAssets(html, pageUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const links = new Set();
  const assets = new Set();

  // Page links
  $('a[href]').each((_, el) => {
    const normalized = normalizePageUrl($(el).attr('href'), pageUrl);
    if (normalized) links.add(normalized);
  });

  // CSS / preload
  $('link[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const u = new URL(href, pageUrl);
      if (u.origin === originUrl.origin) {
        const clean = u.origin + u.pathname;
        if (ASSET_EXTENSIONS.has(path.extname(u.pathname).toLowerCase())) {
          assets.add(clean);
        }
      }
    } catch {}
  });

  // Scripts
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    try {
      const u = new URL(src, pageUrl);
      if (u.origin === originUrl.origin) {
        assets.add(u.origin + u.pathname);
      }
    } catch {}
  });

  // Images (same-origin only — IB CDN images are left external)
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src || src.startsWith('data:')) return;
    try {
      const u = new URL(src, pageUrl);
      if (u.origin === originUrl.origin) {
        assets.add(u.origin + u.pathname);
      }
    } catch {}
  });

  return { links, assets };
}

// ─── Page crawler ─────────────────────────────────────────────────────────────

async function crawlPage(page, pageUrl) {
  const pathname = new URL(pageUrl).pathname;
  const isDirectory = /^\/directory/i.test(pathname);

  console.log(`\n[${visited.size}] ${pageUrl}`);

  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 60000 });
  } catch {
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
      return;
    }
  }

  await scrollToLoadAll(page, isDirectory);

  // One more networkidle check after scrolling
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch {}

  const html = await page.content();
  const { links, assets } = extractLinksAndAssets(html, pageUrl);

  for (const link of links) {
    if (!visited.has(link) && !queue.includes(link)) {
      queue.push(link);
    }
  }
  for (const asset of assets) {
    assetQueue.add(asset);
  }

  const dest = urlToFilePath(pageUrl);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html, 'utf8');
  console.log(`  → saved ${dest.replace(OUT_DIR, '')}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Eastlands Static Crawler ===');
  console.log(`Origin : ${ORIGIN}`);
  console.log(`Output : ${OUT_DIR}\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  // Seed
  queue.push(`${ORIGIN}/`);

  while (queue.length > 0) {
    const pageUrl = queue.shift();
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);
    await crawlPage(page, pageUrl);
  }

  await browser.close();

  console.log(`\n✓ Crawled ${visited.size} pages`);

  // ─── Download assets ──────────────────────────────────────────────────────
  const assetList = [...assetQueue];
  console.log(`\nDownloading ${assetList.length} same-origin assets…\n`);

  const CONCURRENT = 8;
  for (let i = 0; i < assetList.length; i += CONCURRENT) {
    const batch = assetList.slice(i, i + CONCURRENT);
    await Promise.all(
      batch.map(async (assetUrl) => {
        if (downloadedAssets.has(assetUrl)) return;
        downloadedAssets.add(assetUrl);
        const localPath = assetUrlToLocalPath(assetUrl);
        if (!localPath) return;
        process.stdout.write(`  ↓ ${assetUrl.replace(ORIGIN, '')}\n`);
        await downloadFile(assetUrl, localPath);
      })
    );
  }

  console.log(`\n✓ Done. Static site in: ${OUT_DIR}`);
  console.log('Next step: node postprocess.js\n');
}

main().catch(console.error);
