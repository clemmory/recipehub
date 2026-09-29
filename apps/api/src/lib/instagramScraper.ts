import fs from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { extractShortcode, scrapeViaEmbeddedJson } from './instagramJsonScraper';

// Best-effort, unofficial scraping of a public Instagram post's caption and
// media — fragile by nature (depends on Instagram's markup, can break on any
// change, blocked for restricted posts). Accepted risk, see CONCEPTION.md §1.
//
// Strategy (see `scrapeInstagramPost` at the bottom of this file), in order:
//   1. Plain fetch + the post data Instagram embeds as JSON in the page
//      (instagramJsonScraper.ts) — ~1.5s, clean caption, the Reel's real
//      cover, every carousel image. Primary since 2026-09-29.
//   2. Headless browser (everything else in this file) — ~5-11s, reads the
//      caption from the rendered DOM and grabs video frames for Reels.
//      Kept as a fallback only: it's what detects restricted posts, and it
//      covers the case where Instagram changes its embedded JSON.
//   3. Manual entry in ImportScreen when both fail.
//
// History (full details in NOTES.md, "En cours - Phase 2"):
//   2026-09-10  plain fetch + og: meta tags — always failed (empty shell).
//   2026-09-11  headless browser: real page, caption from a CSS selector.
//   2026-09-14  shared browser instance (~-57% time), Reel cover = user
//               picks between two captured video frames.
//   2026-09-26  restricted posts detected instead of scraping UI text.
//   2026-09-29  plain fetch again, but with full browser headers — Instagram
//               then embeds the post's JSON; headless browser → fallback.
//
// Never throws: returns null on any failure so the caller can fall back to
// manual entry (paste caption / add photo) rather than surfacing an error.

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

// A fresh Chromium launch is the single biggest cost in a scrape (confirmed
// by the `time()` instrumentation below) — reused across imports instead of
// launched per-request. Only a Page is opened/closed per import; the
// browser process itself stays warm for the life of the server. Flags trim
// startup work the shared instance never needs (GPU compositing, extension
// loading, background network chatter, audio).
let sharedBrowser: Browser | null = null;

async function getBrowser(executablePath: string): Promise<Browser> {
  if (sharedBrowser && sharedBrowser.connected) {
    return sharedBrowser;
  }
  const launch = () =>
    puppeteer.launch({
      executablePath,
      headless: true,
      args: [
        '--disable-gpu',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-sync',
        '--disable-background-networking',
        '--mute-audio',
      ],
    });
  // One retry: seen 2026-09-29, a launch failed once with an empty
  // "Failed to launch the browser process: Code: 0" and succeeded right
  // after — transient, but enough to turn an import into a failure.
  try {
    sharedBrowser = await launch();
  } catch (err) {
    log(`browser launch failed, retrying once: ${(err as Error).message.split('\n')[0]}`);
    sharedBrowser = await launch();
  }
  return sharedBrowser;
}

// Called from the Fastify `onClose` hook so the browser process doesn't
// outlive the server (dev restarts via `tsx watch`, graceful shutdown).
export async function closeSharedBrowser(): Promise<void> {
  await sharedBrowser?.close().catch(() => {});
  sharedBrowser = null;
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
  // Default recipe photo: the single photo, a Reel's cover, or a carousel's
  // first image (JSON path) — null when the browser fallback only has
  // video frames to offer.
  photo: { data: Buffer; mimeType: string } | null;
  // Several images the user picks from in RecipeEditScreen: every image of
  // a carousel (JSON path, alongside `photo`), or captured video frames
  // when the browser fallback couldn't get a Reel's cover (see
  // captureVideoFrame below). Absent when there's only one image.
  photoCandidates?: { data: Buffer; mimeType: string; label: string }[];
};

// Distinct from a plain failure (`null`): the post exists but Instagram only
// shows it to logged-in users (the author limits who can see their content,
// or it's age-restricted). Nothing to retry — the user has to copy the
// caption from the Instagram app themselves, so the UI says so explicitly.
export type ScrapeRestricted = { restricted: true };

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
    // Only worth waiting out the dismiss animation when there was actually
    // a banner to dismiss — nothing to wait for otherwise.
    if (clicked) {
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
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
    if (clicked) {
      log('caption "...more" toggle expanded');
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  } catch (err) {
    log(`caption expand failed: ${(err as Error).message}`);
  }
}

// Instagram's caption sits in an atomically-class-named <span> (Facebook's
// "stylex" CSS system) — the exact classes were found by inspecting a real
// post on 2026-09-11 and can drift whenever Instagram redeploys its
// frontend. Kept to a single, easily-updatable selector. (Reading
// Instagram's internal JSON instead — the more robust option this comment
// used to defer — is what instagramJsonScraper.ts does since 2026-09-29;
// this selector now only runs in the browser fallback.)
//
// The selector alone isn't unique: it also matches short UI strings ("Never
// miss a post from...", "Meta", "Privacy"...) that share the same atomic
// classes. The caption (username + timestamp + the actual text, no clean
// separator between them) is reliably the longest match by a wide margin,
// so picking the longest is more robust than assuming a fixed position.
//
// Spans inside a [role="dialog"] are skipped: the cookie-consent dialog's
// paragraphs use the same classes and are longer than many real captions
// (285 chars) — found 2026-09-26 on a restricted Reel where the dialog
// text came back as "the caption". The post permalink page itself is never
// a dialog, so the real caption isn't affected.
const CAPTION_SELECTOR = 'span.x1lliihq.x1plvlek';

async function extractCaption(page: Page): Promise<string | null> {
  const text = await page.evaluate((selector) => {
    const texts = Array.from(document.querySelectorAll(selector))
      .filter((el) => !el.closest('[role="dialog"]'))
      .map((el) => el.textContent?.trim() ?? '');
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
// from a different account entirely. See captureVideoFrame() instead.
async function extractImageUrl(page: Page): Promise<string | null> {
  const src = await page.evaluate(async () => {
    // The <img> tag can be in the DOM before its image data has actually
    // decoded — `naturalWidth`/`naturalHeight` stay 0 until then, so
    // checking once immediately after hydration races the image load and
    // intermittently misses it (confirmed 2026-09-14 after shortening the
    // fixed cookie-banner/caption waits made this race more visible). Poll
    // briefly instead of reading the DOM a single time.
    const start = Date.now();
    let img: HTMLImageElement | undefined;
    while (Date.now() - start < 4000) {
      img = Array.from(document.querySelectorAll('img')).find(
        (candidate) =>
          candidate.naturalWidth > 200 &&
          candidate.naturalHeight > 200 &&
          /cdninstagram\.com/.test(candidate.src),
      );
      if (img) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
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

// Reels have no fetchable poster image on their own permalink page — the
// video streams from a blob: URL, and Instagram sets neither the standard
// HTML5 `poster` attribute nor a separate cover <img> (confirmed
// 2026-09-11: the <video> has no siblings, `poster` is empty). Grabbing a
// frame via <video> + canvas is the only way to get *something*.
//
// No single frame is reliably "the cover": tested on real recipe reels,
// the very start can be mid-scene (Reels autoplay near-instantly, so the
// frame in view on arrival is arbitrary), while frames near the end
// sometimes land on a "reveal" shot of the finished dish and sometimes on
// on-video text baked in by the poster's own editing. Rather than guess a
// single percentage, capture a few candidates (see VIDEO_FRAME_TARGETS)
// and let the user pick the one that actually looks like the dish — 2026-
// 09-14, after the single-90%-frame heuristic and the profile-grid cover
// lookup (see NOTES.md) both proved unsatisfying on their own.
async function captureVideoFrame(page: Page, fraction: number): Promise<string | null> {
  try {
    const hasFrame = await page.evaluate(async (targetFraction) => {
      const video = document.querySelector('video');
      if (!video) return false;
      const start = Date.now();
      while (video.readyState < 2 && Date.now() - start < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (video.readyState < 2 || video.videoWidth === 0 || !Number.isFinite(video.duration)) return false;

      const targetTime = video.duration * targetFraction;

      if (targetTime <= video.currentTime + 0.1) {
        // Target is behind (or right at) where playback already is — that
        // range was already buffered by autoplay, so a plain seek works.
        video.pause();
        if (Math.abs(video.currentTime - targetTime) > 0.1) {
          const seeked = new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
          video.currentTime = targetTime;
          await Promise.race([seeked, new Promise((resolve) => setTimeout(resolve, 2000))]);
        }
        return true;
      }

      // Target is ahead of the buffered range. Confirmed 2026-09-14: a
      // Reel's player buffers around the current *playhead* (JS-driven
      // streaming, not a plain progressive file with byte-range seeking),
      // so jumping `video.currentTime` straight to e.g. 98% finds no data
      // there and silently no-ops — the canvas ends up capturing the same
      // frame as the 0% candidate instead of a different one. Playing
      // forward at a high rate instead lets the player buffer naturally as
      // it goes, the same way a real viewer scrubbing through would.
      //
      // A plain while/setTimeout poll is used instead of an rAF loop with a
      // named helper function — Puppeteer serializes this callback's source
      // and re-evaluates it standalone inside the page, and a named local
      // function here gets wrapped by esbuild/tsx's dev-mode name-preserving
      // transform (`__name(fn, "fn")`), which throws `__name is not defined`
      // in that isolated context (confirmed 2026-09-14).
      video.muted = true;
      video.playbackRate = 16;
      await video.play().catch(() => {});
      const playStart = Date.now();
      while (video.currentTime < targetTime && !video.ended && Date.now() - playStart < 6000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      video.pause();
      return true;
    }, fraction);
    if (!hasFrame) {
      log(`no <video> element with a decoded frame found (target ${Math.round(fraction * 100)}%)`);
      return null;
    }
    const dataUrl = await page.evaluate(() => {
      const video = document.querySelector('video') as HTMLVideoElement;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    });
    log(`captured a frame at ${Math.round(fraction * 100)}% of the video`);
    return dataUrl;
  } catch (err) {
    log(`video frame capture failed at ${Math.round(fraction * 100)}%: ${(err as Error).message}`);
    return null;
  }
}

const VIDEO_FRAME_TARGETS: { fraction: number; label: string }[] = [
  { fraction: 0, label: 'Début' },
  { fraction: 0.98, label: '98%' },
];

async function captureVideoFrameCandidates(page: Page): Promise<NonNullable<ScrapedPost['photoCandidates']>> {
  const candidates: NonNullable<ScrapedPost['photoCandidates']> = [];
  for (const { fraction, label } of VIDEO_FRAME_TARGETS) {
    const dataUrl = await captureVideoFrame(page, fraction);
    if (!dataUrl) continue;
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) continue;
    candidates.push({ data: Buffer.from(match[2], 'base64'), mimeType: match[1], label });
  }
  return candidates;
}

// Instagram serves a "This content is unavailable" shell (with e.g. "This
// account has set limits on who can see their profile and content.") for
// posts it won't show logged-out visitors. Found 2026-09-26: without this
// check the scraper reported success with that UI text as "the caption"
// and sent it to Claude. Matched on the page title plus known body strings,
// in both English and French since the locale isn't ours to pick.
async function isRestrictedPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const title = document.title;
    const body = document.body?.innerText.slice(0, 3000) ?? '';
    return (
      /content is unavailable|contenu n.est pas disponible|contenu indisponible/i.test(title) ||
      /set limits on who can see|limite qui peut voir|people under 13 can.t see|moins de 13 ans/i.test(body)
    );
  });
}

export async function scrapeInstagramPost(url: string): Promise<ScrapedPost | ScrapeRestricted | null> {
  const start = Date.now();
  const json = await scrapeViaEmbeddedJson(url);
  if (json.ok) {
    log(`import via embedded JSON succeeded in ${Date.now() - start}ms`);
    return json.post;
  }
  if (json.reason === 'bad-url') {
    // Not a post URL at all — the browser wouldn't do any better.
    return null;
  }
  // `no-media-json` is also what a restricted post looks like from the JSON
  // side — the browser fallback is what tells the two apart (and gives the
  // user the dedicated "copy the caption by hand" message).
  log(`embedded JSON unusable (${json.reason}) — falling back to the headless browser`);
  const fallback = await scrapeWithHeadlessBrowser(url);
  log(
    `headless-browser fallback finished in ${Date.now() - start}ms total: ${
      fallback === null ? 'nothing usable' : 'restricted' in fallback ? 'restricted post' : 'got data'
    }`,
  );
  return fallback;
}

export async function scrapeWithHeadlessBrowser(url: string): Promise<ScrapedPost | ScrapeRestricted | null> {
  const executablePath = resolveExecutablePath();
  if (!executablePath) {
    log('no Chromium-based browser found — set PUPPETEER_EXECUTABLE_PATH or install one, see .env.example');
    return null;
  }
  // Same clean URL as the JSON path — drops share-tracking params (?stkn=...).
  const shortcode = extractShortcode(url);
  if (shortcode) url = `https://www.instagram.com/${shortcode.kind}/${shortcode.code}/`;
  log(`scraping ${url} using browser at ${executablePath}`);

  const overallStart = Date.now();
  let pageToClose: Page | undefined;
  try {
    const browser = await time('browser launch', () => getBrowser(executablePath));
    const page = await browser.newPage();
    pageToClose = page;
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
          // Also stop waiting as soon as the "content unavailable" shell is
          // up — a restricted post never mounts a <video>, and waiting out
          // the full timeout for one just delays the inevitable.
          (sel, expectVideo) =>
            /content is unavailable|contenu n.est pas disponible|contenu indisponible/i.test(document.title) ||
            (expectVideo ? Boolean(document.querySelector('video')) : Boolean(document.querySelector(sel) || document.querySelector('video'))),
          { timeout: 8000 },
          CAPTION_SELECTOR,
          isReelUrl,
        )
        .catch(() => {}),
    );

    await dismissCookieBanner(page);

    if (await isRestrictedPage(page)) {
      log(`post is restricted to logged-in users (account limits or age gate) — nothing to scrape, after ${Date.now() - overallStart}ms`);
      return { restricted: true };
    }

    await expandCaption(page);

    const caption = await extractCaption(page);

    // Try for a real photo first, video-frame capture only as a fallback —
    // NOT an `isVideoPost` branch decided up front. Confirmed 2026-09-14 on
    // a genuine photo post: a `<video>` can exist elsewhere on the page
    // (e.g. a carousel post preloads a later video slide's element even
    // while the default/first slide — the one we actually want — is a
    // photo), so checking "does a video exist anywhere" and branching on
    // it intermittently misclassified photo posts as video ones depending
    // on hydration timing. A successful image extraction is unambiguous
    // proof this post has a usable static photo, so it takes priority.
    let photo: ScrapedPost['photo'] = null;
    let photoCandidates: ScrapedPost['photoCandidates'];
    if (!isReelUrl) {
      const imageUrl = await extractImageUrl(page);
      if (imageUrl) {
        photo = await time('photo download', () => downloadPhoto(imageUrl));
      }
    }
    if (!photo) {
      const hasVideo =
        isReelUrl ||
        (await page.evaluate(() => Array.from(document.querySelectorAll('video')).some((v) => v.offsetWidth > 200)));
      if (hasVideo) {
        const candidates = await time('video-frame capture', () => captureVideoFrameCandidates(page));
        if (candidates.length > 0) {
          photoCandidates = candidates;
        }
      }
    }

    const hasCandidates = Boolean(photoCandidates && photoCandidates.length > 0);
    if (!caption && !photo && !hasCandidates) {
      log(`scrape finished with nothing usable after ${Date.now() - overallStart}ms — falling back to manual entry`);
      return null;
    }
    log(
      `scrape succeeded in ${Date.now() - overallStart}ms (caption: ${caption ? 'yes' : 'no'}, photo: ${
        photo ? 'yes' : hasCandidates ? `${photoCandidates!.length} candidate(s)` : 'no'
      })`,
    );
    return { caption, photo, photoCandidates };
  } catch (err) {
    log(`scrape failed with an error after ${Date.now() - overallStart}ms: ${(err as Error).message}`);
    return null;
  } finally {
    await pageToClose?.close().catch(() => {});
  }
}
