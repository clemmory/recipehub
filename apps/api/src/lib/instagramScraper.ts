import fs from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

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
  sharedBrowser = await puppeteer.launch({
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
  photo: { data: Buffer; mimeType: string } | null;
  // Video posts (Reels) have no single reliable cover (see captureVideoFrame
  // below) — instead of guessing one frame, several candidates are offered
  // and the user picks. Absent/empty for photo posts, which use `photo`.
  photoCandidates?: { data: Buffer; mimeType: string; label: string }[];
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

export async function scrapeInstagramPost(url: string): Promise<ScrapedPost | null> {
  const executablePath = resolveExecutablePath();
  if (!executablePath) {
    log('no Chromium-based browser found — set PUPPETEER_EXECUTABLE_PATH or install one, see .env.example');
    return null;
  }
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
