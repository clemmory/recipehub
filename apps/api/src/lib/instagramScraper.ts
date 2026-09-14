import fs from 'node:fs';
import puppeteer, { type Page } from 'puppeteer-core';

// Best-effort, unofficial scraping of a public Instagram post's caption and
// media — fragile by nature (depends on Instagram's markup, can break on any
// change, blocked for private posts). Accepted risk, see CONCEPTION.md §1.
//
// Uses a real (headless) browser rather than a plain HTTP fetch: testing on
// 2026-09-11 showed Instagram serves an empty app shell — no og:description/
// og:image, no embedded caption JSON — to non-browser requests, on both
// Reels and photo posts. A headless browser (even without TLS-fingerprint
// tricks) gets the real, JS-hydrated page. See NOTES.md for the full
// diagnostic. Never throws: returns null on any failure so the caller can
// fall back to manual entry (paste caption / add photo) rather than
// surfacing an error.

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// puppeteer-core doesn't bundle a browser — point it at whatever Chromium-
// based browser is already on the machine. PUPPETEER_EXECUTABLE_PATH wins
// when set (this is how the production Ubuntu server should be configured,
// e.g. after `apt install chromium`); otherwise fall back to common
// per-OS install locations for local dev.
const CANDIDATE_EXECUTABLE_PATHS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter((path): path is string => Boolean(path));

function resolveExecutablePath(): string | null {
  return CANDIDATE_EXECUTABLE_PATHS.find((path) => fs.existsSync(path)) ?? null;
}

function log(message: string): void {
  console.log(`[instagramScraper] ${message}`);
}

// Timing instrumentation added 2026-09-11 after the import flow was
// reported as slow — logs how long each phase actually takes so a fix can
// target the real bottleneck instead of guessing.
async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  log(`${label}: ${Date.now() - start}ms`);
  return result;
}

export type ScrapedPost = {
  caption: string | null;
  photo: { data: Buffer; mimeType: string } | null;
};

// Cookie-consent banner blocks the page on a fresh (cookie-less) browser
// profile — dismiss it before reading anything. English and French copy
// both handled since Instagram picks the wording from request locale hints
// we don't control.
async function dismissCookieBanner(page: Page): Promise<void> {
  try {
    const clicked = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('button, div[role="button"]')).find((el) =>
        /decline optional cookies|allow all cookies|refuser les cookies|autoriser tous les cookies/i.test(
          el.textContent ?? '',
        ),
      );
      (button as HTMLElement | undefined)?.click();
      return Boolean(button);
    });
    log(clicked ? 'cookie banner dismissed' : 'no cookie banner found (page may already be past it)');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (err) {
    log(`cookie banner dismissal failed: ${(err as Error).message}`);
  }
}

// The post permalink page usually shows the full caption already, but a
// "... more"/"...plus" toggle can still truncate very long ones — click it
// so extractCaption() never reads a cut-off caption.
async function expandCaption(page: Page): Promise<void> {
  try {
    const clicked = await page.evaluate(() => {
      const toggle = Array.from(document.querySelectorAll('span, div[role="button"]')).find((el) =>
        /^(\.{3}\s*)?(more|plus)$/i.test((el.textContent ?? '').trim()),
      );
      (toggle as HTMLElement | undefined)?.click();
      return Boolean(toggle);
    });
    if (clicked) log('caption "...more" toggle expanded');
    await new Promise((resolve) => setTimeout(resolve, 300));
  } catch (err) {
    log(`caption expand failed: ${(err as Error).message}`);
  }
}

// Instagram's caption sits in an atomically-class-named <span> (Facebook's
// "stylex" CSS system) — the exact classes were found by inspecting a real
// post on 2026-09-11 and can drift whenever Instagram redeploys its
// frontend. Kept to a single, easily-updatable selector rather than
// parsing Instagram's internal JSON blob (more robust long-term, but far
// more complex — not worth it for a v1).
//
// The selector alone isn't unique: it also matches short UI strings ("Never
// miss a post from...", "Meta", "Privacy"...) that share the same atomic
// classes. The caption (username + timestamp + the actual text, no clean
// separator between them) is reliably the longest match by a wide margin,
// so picking the longest is more robust than assuming a fixed position.
const CAPTION_SELECTOR = 'span.x1lliihq.x1plvlek';

async function extractCaption(page: Page): Promise<string | null> {
  const text = await page.evaluate((selector) => {
    const texts = Array.from(document.querySelectorAll(selector)).map((el) => el.textContent?.trim() ?? '');
    return texts.reduce((longest, current) => (current.length > longest.length ? current : longest), '');
  }, CAPTION_SELECTOR);
  log(text ? `caption found (${text.length} chars)` : `no caption found — selector "${CAPTION_SELECTOR}" may be stale`);
  return text && text.length > 0 ? text : null;
}

// Used for photo posts: the post's own image is the first sufficiently-large
// <img> served from Instagram's CDN, in document order, ahead of the
// (smaller, later) "More posts from..." suggestion thumbnails at the bottom
// of the page.
//
// NOT used for Reels/video posts — a Reel's own thumbnail is never a plain
// <img> (the video streams from a blob: URL), and every <img> matching this
// heuristic on a Reel page turned out to belong to unrelated suggested posts
// from a different account entirely. Video posts get no photo for now (see
// scrapeInstagramPost) — the manual fallback (add a photo) covers that gap.
async function extractImageUrl(page: Page): Promise<string | null> {
  const src = await page.evaluate(() => {
    const img = Array.from(document.querySelectorAll('img')).find(
      (candidate) =>
        candidate.naturalWidth > 200 &&
        candidate.naturalHeight > 200 &&
        /cdninstagram\.com/.test(candidate.src),
    );
    return img?.src ?? null;
  });
  log(src ? 'post image found' : 'no post image found');
  return src;
}

async function downloadPhoto(url: string): Promise<ScrapedPost['photo']> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_USER_AGENT } });
  if (!res.ok) {
    log(`photo download failed: HTTP ${res.status}`);
    return null;
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg';
  return { data: buffer, mimeType };
}

export async function scrapeInstagramPost(url: string): Promise<ScrapedPost | null> {
  const executablePath = resolveExecutablePath();
  if (!executablePath) {
    log('no Chromium-based browser found — set PUPPETEER_EXECUTABLE_PATH or install one, see .env.example');
    return null;
  }
  log(`scraping ${url} using browser at ${executablePath}`);

  let browser;
  const overallStart = Date.now();
  try {
    browser = await time('browser launch', async () => puppeteer.launch({ executablePath, headless: true }));
    const page = await browser.newPage();
    await page.setUserAgent(BROWSER_USER_AGENT);
    await page.setViewport({ width: 1280, height: 2200 });
    // `networkidle2` waits for Instagram's background chatter (telemetry,
    // polling) to settle, which on this JS-heavy app shell adds several
    // seconds beyond when the content we actually need is already there —
    // measured 2026-09-11 (see NOTES.md) as the single biggest chunk of a
    // slow import. `domcontentloaded` + waiting for the specific selector
    // we're about to read is faster and just as reliable, since that's the
    // real readiness signal.
    //
    // A /reel/ URL is unambiguously a video post — wait specifically for
    // its <video> to mount rather than racing it against the caption span,
    // which hydrates first and would otherwise make the wait resolve
    // before the video exists (confirmed by testing: the very first version
    // of this optimization misdetected every Reel as a photo post because
    // of that race).
    const isReelUrl = /\/reel\//.test(url);
    await time('post page load', () => page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }));
    await time('post page hydration', () =>
      page
        .waitForFunction(
          (sel, expectVideo) => (expectVideo ? Boolean(document.querySelector('video')) : Boolean(document.querySelector(sel) || document.querySelector('video'))),
          { timeout: 8000 },
          CAPTION_SELECTOR,
          isReelUrl,
        )
        .catch(() => {}),
    );

    await dismissCookieBanner(page);
    await expandCaption(page);

    const caption = await extractCaption(page);

    // Video posts (Reels) get no photo for now — no fetchable thumbnail
    // exists on the Reel's own page (see extractImageUrl above), and there
    // is no cover-image extraction in place; the caption alone (plus a
    // manually-added photo) covers that case.
    const isVideoPost = isReelUrl || (await page.evaluate(() => Boolean(document.querySelector('video'))));

    let photo: ScrapedPost['photo'] = null;
    if (!isVideoPost) {
      const imageUrl = await extractImageUrl(page);
      if (imageUrl) {
        photo = await time('photo download', () => downloadPhoto(imageUrl));
      }
    }

    if (!caption && !photo) {
      log(`scrape finished with nothing usable after ${Date.now() - overallStart}ms — falling back to manual entry`);
      return null;
    }
    log(
      `scrape succeeded in ${Date.now() - overallStart}ms (caption: ${caption ? 'yes' : 'no'}, photo: ${photo ? 'yes' : 'no'})`,
    );
    return { caption, photo };
  } catch (err) {
    log(`scrape failed with an error after ${Date.now() - overallStart}ms: ${(err as Error).message}`);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
