// Best-effort, unofficial scraping of a public Instagram post's caption and
// media — fragile by nature (depends on Instagram's HTML, can break on any
// change, blocked for private posts). Accepted risk, see CONCEPTION.md §1.
// Never throws: returns null on any failure so the caller can fall back to
// manual entry (paste caption / add photo) rather than surfacing an error.

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export type ScrapedPost = {
  caption: string | null;
  photo: { data: Buffer; mimeType: string } | null;
};

function extractMetaContent(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`,
    'i',
  );
  const match = html.match(pattern);
  return match ? decodeHtmlEntities(match[1]) : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

export async function scrapeInstagramPost(url: string): Promise<ScrapedPost | null> {
  try {
    const pageRes = await fetch(url, { headers: { 'User-Agent': BROWSER_USER_AGENT } });
    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    const caption = extractMetaContent(html, 'og:description');
    const imageUrl = extractMetaContent(html, 'og:image');

    if (!caption && !imageUrl) return null;

    let photo: ScrapedPost['photo'] = null;
    if (imageUrl) {
      const imageRes = await fetch(imageUrl, { headers: { 'User-Agent': BROWSER_USER_AGENT } });
      if (imageRes.ok) {
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        const mimeType = imageRes.headers.get('content-type') ?? 'image/jpeg';
        photo = { data: buffer, mimeType };
      }
    }

    return { caption, photo };
  } catch {
    return null;
  }
}
