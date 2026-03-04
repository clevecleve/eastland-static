#!/usr/bin/env node
/**
 * postprocess.js — Cheerio-based HTML cleaner for the static site
 *
 * Run after crawl.js. Fixes all HTML files in dist/:
 *  1. Strip __JSS_STATE__ blobs (confirmed safe — React bundles not loaded)
 *  2. Remove 'sticky' class from nav/header elements (scroll-capture artifact)
 *  3. Remove scroll-lock artifacts: noscroll class + top:-Xpx style on <html>
 *  4. Rewrite absolute internal URLs → root-relative paths
 *  5. Wire desktop submenu anchor links (add href="#id" from class name)
 *  6. Fix Mappedin iframe: ensure src is kept, add allow="fullscreen" attr
 *  7. Inject /static-fixes.js before </body>
 *
 * Usage:  node postprocess.js
 * Env:    CRAWL_ORIGIN, CRAWL_OUT_DIR
 */

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ORIGIN = (process.env.CRAWL_ORIGIN || 'https://eastland.qicre.com').replace(/\/$/, '');
const OUT_DIR = process.env.CRAWL_OUT_DIR || path.join(__dirname, 'dist');
const originUrl = new URL(ORIGIN);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAllHtmlFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...getAllHtmlFiles(full));
    else if (entry.name.endsWith('.html')) files.push(full);
  }
  return files;
}

function toRootRelative(href) {
  if (!href) return href;
  try {
    const u = new URL(href);
    if (u.origin === originUrl.origin) {
      return u.pathname + (u.search || '') + (u.hash || '');
    }
  } catch {}
  return href;
}

// ─── Per-file processor ───────────────────────────────────────────────────────

function processFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const $ = cheerio.load(raw, { decodeEntities: false });
  let changed = false;

  const mark = () => { changed = true; };

  // 1. Strip __JSS_STATE__ — large JSON blob, not read by browser in static mode
  $('script#__JSS_STATE__[type="application/json"]').each((_, el) => {
    $(el).remove(); mark();
  });

  // 2. Remove 'sticky' class from any element — usually added to sub-nav on scroll,
  //    but baked into the captured HTML and causes it to pin incorrectly.
  $('[class]').each((_, el) => {
    const cls = $(el).attr('class') || '';
    if (/\bsticky\b/.test(cls)) {
      $(el).attr('class', cls.replace(/\bsticky\b/g, '').replace(/\s+/g, ' ').trim());
      mark();
    }
  });

  // 3. Remove scroll-lock artifacts on <html> element
  //    React adds class="noscroll" + style="top:-XXXpx" when modals/menus open.
  const $html = $('html');
  const htmlCls = $html.attr('class') || '';
  if (/\bnoscroll\b/.test(htmlCls)) {
    $html.attr('class', htmlCls.replace(/\bnoscroll\b/g, '').replace(/\s+/g, ' ').trim());
    mark();
  }
  const htmlStyle = $html.attr('style') || '';
  if (/top\s*:/.test(htmlStyle)) {
    const cleaned = htmlStyle.replace(/top\s*:\s*-?\d+px\s*;?/g, '').trim();
    if (cleaned) $html.attr('style', cleaned);
    else $html.removeAttr('style');
    mark();
  }

  // 4. Rewrite absolute internal URLs → root-relative
  const rewriteAttr = (selector, attr) => {
    $(selector).each((_, el) => {
      const val = $(el).attr(attr);
      const rel = toRootRelative(val);
      if (rel !== val) { $(el).attr(attr, rel); mark(); }
    });
  };
  rewriteAttr('a[href]', 'href');
  rewriteAttr('link[href]', 'href');
  rewriteAttr('script[src]', 'src');
  rewriteAttr('img[src]', 'src');
  rewriteAttr('source[src]', 'src');
  rewriteAttr('source[srcset]', 'srcset');
  rewriteAttr('form[action]', 'action');

  // 5. Wire desktop submenu anchor links
  //    Pattern: <a class="item SECTION-ID"> with no href → add href="#SECTION-ID"
  $('a.item').each((_, el) => {
    if ($(el).attr('href')) return; // already has href
    const classes = ($(el).attr('class') || '').split(/\s+/).filter(Boolean);
    const sectionClass = classes.find((c) => c !== 'item' && c !== 'active');
    if (sectionClass && $(`#${sectionClass}`).length > 0) {
      $(el).attr('href', `#${sectionClass}`);
      mark();
    }
  });

  // 6. Mappedin iframe — ensure it's preserved and functional
  $('iframe[src*="mappedin"], iframe[src*="maps.qicre"]').each((_, el) => {
    const existing = $(el).attr('allow') || '';
    if (!existing.includes('fullscreen')) {
      $(el).attr('allow', (existing + ' fullscreen').trim());
      mark();
    }
    // Make sure it's not sandboxed in a way that breaks it
    const sandbox = $(el).attr('sandbox');
    if (sandbox !== undefined && !sandbox.includes('allow-scripts')) {
      $(el).attr('sandbox', 'allow-scripts allow-same-origin allow-popups');
      mark();
    }
  });

  // 7. Inject static-fixes.js before </body> if not already present
  if (!$('script[src="/static-fixes.js"]').length) {
    $('body').append('\n<script src="/static-fixes.js"></script>');
    mark();
  }

  if (changed) {
    fs.writeFileSync(filePath, $.html(), 'utf8');
  }
  return changed;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log('=== Post-processor ===');
  console.log(`Directory: ${OUT_DIR}\n`);

  const files = getAllHtmlFiles(OUT_DIR);
  console.log(`Found ${files.length} HTML files\n`);

  let updated = 0;
  let jssStripped = 0;

  for (const f of files) {
    const rel = f.replace(OUT_DIR, '');
    // Quick check for JSS_STATE before full parse (perf)
    const raw = fs.readFileSync(f, 'utf8');
    if (raw.includes('__JSS_STATE__')) jssStripped++;

    const wasChanged = processFile(f);
    if (wasChanged) {
      updated++;
      process.stdout.write(`  ✓ ${rel}\n`);
    }
  }

  console.log(`\n✓ Updated    : ${updated}/${files.length} files`);
  console.log(`✓ JSS stripped : ${jssStripped} files`);
  console.log('\nNext step: npm run serve → http://localhost:3456\n');
}

main();
