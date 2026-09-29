import type { ScrapedPost } from './instagramScraper';

// Primary Instagram scraping strategy since 2026-09-29: a plain HTTP fetch of
// the post page, then reading the post's data straight out of the JSON that
// Instagram embeds in the initial HTML (`<script type="application/json">`
// blocks) — no headless browser, no CSS selectors, no video playback.
//
// Why this works now when the 2026-09-10 plain-fetch version didn't: that
// version sent only a User-Agent and looked for `og:` meta tags. Instagram
// only embeds the post data when the request looks like a real top-level
// browser navigation — the `Sec-Fetch-*`/`Accept`/`Accept-Language` headers
// below. Measured 2026-09-29 on the same Reel: User-Agent alone → 639 KB
// page with no post data; full browser headers → 764 KB page with it.
//
// What the JSON gives us that the headless-browser scraper couldn't:
// - the caption as the author wrote it (`caption.text`), line breaks
//   included and without the "username Verified 48 w" prefix the DOM text
//   had glued in front of it;
// - a Reel's real cover image (`image_versions2`) — the one the author
//   picked, full resolution — instead of frames grabbed from the video;
// - every image of a carousel (`carousel_media`), not just the first.
//
// The keys read here (`code`, `caption.text`, `image_versions2.candidates`,
// `carousel_media`) are Instagram's own media data model, the same shape
// its API has returned for years — much more stable than the auto-generated
// CSS class names the DOM scraper depends on. Still unofficial: if this
// stops working, `scrapeInstagramPost` falls back to the headless browser,
// and `npm run check:instagram` exists to notice it early.

const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
};

const PAGE_TIMEOUT_MS = 10000;
const IMAGE_TIMEOUT_MS = 10000;
// Instagram allows up to 20 images per carousel — offering more than this
// as photo choices isn't useful and would bloat the response (each image is
// sent to the phone as base64).
const MAX_CAROUSEL_IMAGES = 10;

function log(message: string): void {
  console.log(`[instagramJsonScraper] ${message}`);
}

// Why the JSON path gave up — logged, and returned so the caller can decide
// whether falling back to the headless browser is worth it.
export type JsonScrapeFailure =
  | 'bad-url' // no /p/, /reel/ or /tv/ shortcode in the URL
  | 'http-error' // non-200, network error or timeout
  | 'no-media-json' // page came back, but without this post's data (restricted post, login wall, or Instagram changed the page)
  | 'no-image'; // post data found but no downloadable image

export type JsonScrapeResult = { ok: true; post: ScrapedPost } | { ok: false; reason: JsonScrapeFailure };

// The same post can be reached through several URL shapes (/reel/X/,
// /p/X/, /<username>/reel/X/, with share-tracking params like ?stkn=...).
// The shortcode is the stable identifier — used both to build a clean URL
// (no tracking params sent to Instagram) and to pick the right post out of
// the page's JSON, which can also contain other posts (suggestions).
export function extractShortcode(url: string): { kind: 'p' | 'reel' | 'tv'; code: string } | null {
  const match = url.match(/instagram\.com\/(?:[^/?#]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const kind = match[1] === 'reels' ? 'reel' : (match[1] as 'p' | 'reel' | 'tv');
  return { kind, code: match[2] };
}

type ImageCandidate = { url: string; width?: number; height?: number };
type MediaNode = {
  code?: string;
  product_type?: string;
  caption?: { text?: string } | null;
  image_versions2?: { candidates?: ImageCandidate[] };
  carousel_media?: { image_versions2?: { candidates?: ImageCandidate[] } }[];
  video_versions?: { url: string }[];
};

// Walks the parsed JSON looking for the media object of *this* post (the
// one whose `code` is the URL's shortcode). The embedded JSON is deeply
// nested and its outer structure is Instagram's internal plumbing (Relay
// store, route definitions...) — searching for the media object by its own
// shape rather than by a fixed path is what keeps this robust to changes
// in that plumbing.
function findMediaNode(node: unknown, shortcode: string): MediaNode | null {
  if (!node || typeof node !== 'object') return null;
  const candidate = node as MediaNode;
  if (candidate.code === shortcode && candidate.image_versions2) return candidate;
  for (const value of Object.values(node)) {
    const found = findMediaNode(value, shortcode);
    if (found) return found;
  }
  return null;
}

function extractMediaNode(html: string, shortcode: string): MediaNode | null {
  const scripts = html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g);
  for (const [, content] of scripts) {
    // Cheap pre-filter: skip the dozens of unrelated JSON blocks without
    // parsing them.
    if (!content.includes('image_versions2') || !content.includes(shortcode)) continue;
    try {
      const found = findMediaNode(JSON.parse(content), shortcode);
      if (found) return found;
    } catch (err) {
      log(`skipped an unparseable JSON block: ${(err as Error).message}`);
    }
  }
  return null;
}

// Instagram lists several resolutions per image — take the largest.
function largestCandidate(candidates: ImageCandidate[] | undefined): ImageCandidate | null {
  if (!candidates || candidates.length === 0) return null;
  return candidates.reduce((best, current) =>
    (current.width ?? 0) * (current.height ?? 0) > (best.width ?? 0) * (best.height ?? 0) ? current : best,
  );
}

async function downloadImage(url: string): Promise<{ data: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': REQUEST_HEADERS['User-Agent'] },
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      log(`image download failed: HTTP ${res.status}`);
      return null;
    }
    return { data: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get('content-type') ?? 'image/jpeg' };
  } catch (err) {
    log(`image download failed: ${(err as Error).message}`);
    return null;
  }
}

export async function scrapeViaEmbeddedJson(url: string): Promise<JsonScrapeResult> {
  const start = Date.now();
  const shortcode = extractShortcode(url);
  if (!shortcode) {
    log(`no post shortcode in ${url}`);
    return { ok: false, reason: 'bad-url' };
  }
  const cleanUrl = `https://www.instagram.com/${shortcode.kind}/${shortcode.code}/`;

  let html: string;
  try {
    const res = await fetch(cleanUrl, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    html = await res.text();
    log(`fetched ${cleanUrl}: HTTP ${res.status}, ${Math.round(html.length / 1024)} KB in ${Date.now() - start}ms`);
    if (!res.ok) return { ok: false, reason: 'http-error' };
  } catch (err) {
    log(`page fetch failed after ${Date.now() - start}ms: ${(err as Error).message}`);
    return { ok: false, reason: 'http-error' };
  }

  const media = extractMediaNode(html, shortcode.code);
  if (!media) {
    log(`no media JSON for ${shortcode.code} in the page — restricted post, login wall, or page format changed`);
    return { ok: false, reason: 'no-media-json' };
  }

  const caption = media.caption?.text?.trim() || null;
  // A carousel's own `image_versions2` is just its first slide — use the
  // per-slide list instead so every image is offered. A Reel's
  // `image_versions2` is its cover (the author's choice, not a video frame).
  const imageUrls = (
    media.carousel_media?.length
      ? media.carousel_media.slice(0, MAX_CAROUSEL_IMAGES).map((item) => largestCandidate(item.image_versions2?.candidates))
      : [largestCandidate(media.image_versions2?.candidates)]
  )
    .filter((c): c is ImageCandidate => Boolean(c))
    .map((c) => c.url);
  log(
    `post ${shortcode.code}: type ${media.product_type ?? '?'}, caption ${caption ? `${caption.length} chars` : 'none'}, ` +
      `${imageUrls.length} image(s)${media.video_versions?.length ? ', video URL available' : ''}`,
  );

  const downloadStart = Date.now();
  const images = (await Promise.all(imageUrls.map(downloadImage))).filter(
    (img): img is { data: Buffer; mimeType: string } => Boolean(img),
  );
  log(`downloaded ${images.length}/${imageUrls.length} image(s) in ${Date.now() - downloadStart}ms`);
  if (images.length === 0) return { ok: false, reason: 'no-image' };

  // First image (Reel cover / single photo / first carousel slide) is the
  // default recipe photo. A carousel also offers every slide as a choice,
  // picked by the user in RecipeEditScreen.
  const post: ScrapedPost = {
    caption,
    photo: images[0],
    photoCandidates:
      images.length > 1 ? images.map((img, index) => ({ ...img, label: `Photo ${index + 1}` })) : undefined,
  };
  log(`JSON scrape succeeded in ${Date.now() - start}ms`);
  return { ok: true, post };
}
