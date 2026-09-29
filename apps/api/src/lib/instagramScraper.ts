// Best-effort, unofficial scraping of a public Instagram post's caption and
// images — fragile by nature (Instagram can change its pages at any time,
// and restricted posts are out of reach). Accepted risk, see CONCEPTION.md
// §1. The safety net is manual entry in ImportScreen (paste the caption /
// add a photo), and `npm run check:instagram` exists to notice a break.
//
// How it works (since 2026-09-29): a plain HTTP fetch of the post page, then
// reading the post's data straight out of the JSON Instagram embeds in the
// initial HTML (`<script type="application/json">` blocks) — no headless
// browser, no CSS selectors, no video playback. ~1-1.5s per post.
//
// Instagram only embeds the post data when the request looks like a real
// top-level browser navigation — the `Sec-Fetch-*`/`Accept`/
// `Accept-Language` headers below. Measured 2026-09-29 on the same Reel:
// User-Agent alone → 639 KB page with no post data; full browser headers →
// 764 KB page with it. (That missing-headers detail is why the very first
// plain-fetch version, 2026-09-10, failed and led to the headless browser.)
//
// What the JSON gives us:
// - the caption as the author wrote it (`caption.text`), line breaks
//   included, without the "username Verified 48 w" prefix the rendered page
//   glued in front of it;
// - a Reel's real cover image (`image_versions2`) — the one the author
//   picked, full resolution;
// - every image of a carousel (`carousel_media`).
// The keys read here are Instagram's own media data model, the same shape
// its API has returned for years — far more stable than the auto-generated
// CSS class names the previous (DOM-based) scraper depended on.
//
// History (full details in NOTES.md, "En cours - Phase 2"):
//   2026-09-10  plain fetch + og: meta tags — always failed.
//   2026-09-11  headless browser (puppeteer-core), caption from a CSS
//               selector, image from the first large <img>.
//   2026-09-14  shared browser (~-57% time); Reel cover = user picks
//               between two captured video frames (0% / 98%).
//   2026-09-26  restricted posts detected in the browser page.
//   2026-09-29  plain fetch + embedded JSON as primary, browser as fallback;
//               then, same day, browser removed entirely (it only still
//               served to word the "restricted" message precisely).
//
// Never throws: always returns a result the route can turn into a 200.

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
  console.log(`[instagramScraper] ${message}`);
}

export type ScrapedPost = {
  caption: string | null;
  // Default recipe photo: the single photo, a Reel's cover, or a carousel's
  // first image.
  photo: { data: Buffer; mimeType: string };
  // Every image of a carousel ("Photo 1", "Photo 2"...), for the user to
  // pick from in RecipeEditScreen. Absent when there's only one image.
  photoCandidates?: { data: Buffer; mimeType: string; label: string }[];
};

// Why scraping gave up — logged, and `unavailable` is surfaced to the app.
export type ScrapeFailure =
  | 'bad-url' // no /p/, /reel/ or /tv/ shortcode in the URL
  | 'http-error' // non-200, network error or timeout
  // Page came back without this post's data. From a plain fetch, a
  // restricted post (author limits who can see it, age gate — only shown to
  // logged-in users), a deleted/nonexistent post and an Instagram page
  // change all look identical (verified 2026-09-29: same ~642 KB page,
  // title "Instagram", no data). The app shows one message covering the
  // first two; `npm run check:instagram` is what catches the third.
  | 'unavailable'
  | 'no-image'; // post data found but no downloadable image

export type ScrapeResult = { ok: true; post: ScrapedPost } | { ok: false; reason: ScrapeFailure };

// The same post can be reached through several URL shapes (/reel/X/,
// /p/X/, /<username>/reel/X/, with share-tracking params like ?stkn=...).
// The shortcode is the stable identifier — used both to build a clean URL
// (no tracking params sent to Instagram) and to pick the right post out of
// the page's JSON, which can also contain other posts (suggestions).
function extractShortcode(url: string): { kind: 'p' | 'reel' | 'tv'; code: string } | null {
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

// Image URLs are signed and expire — always download right away, never
// store the URL itself.
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

export async function scrapeInstagramPost(url: string): Promise<ScrapeResult> {
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
    log(
      `no media JSON for ${shortcode.code} — restricted or deleted post, or Instagram changed its page ` +
        `(run npm run check:instagram if this happens on public posts)`,
    );
    return { ok: false, reason: 'unavailable' };
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
      // The video URL isn't used yet — logged because it's what the planned
      // audio transcription (CONCEPTION.md §6) would download.
      `${imageUrls.length} image(s)${media.video_versions?.length ? ', video URL available' : ''}`,
  );

  const downloadStart = Date.now();
  const images = (await Promise.all(imageUrls.map(downloadImage))).filter(
    (img): img is { data: Buffer; mimeType: string } => Boolean(img),
  );
  log(`downloaded ${images.length}/${imageUrls.length} image(s) in ${Date.now() - downloadStart}ms`);
  if (images.length === 0) return { ok: false, reason: 'no-image' };

  const post: ScrapedPost = {
    caption,
    photo: images[0],
    photoCandidates:
      images.length > 1 ? images.map((img, index) => ({ ...img, label: `Photo ${index + 1}` })) : undefined,
  };
  log(`scrape succeeded in ${Date.now() - start}ms`);
  return { ok: true, post };
}
