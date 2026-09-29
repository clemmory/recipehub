// Smoke test for Instagram import — `npm run check:instagram` (repo root or
// apps/api). Added 2026-09-29 with the embedded-JSON scraper.
//
// Scraping Instagram is unofficial and can break whenever Instagram changes
// its pages. In the app, a break is silent: the headless-browser fallback
// takes over (slower, lower-quality photo) or the user lands on manual
// entry. This script tests the JSON path *directly* (no fallback) on a few
// known posts, so a break shows up here as a clear FAIL instead.
//
// Reference posts are real public posts chosen on 2026-09-29 — if one gets
// deleted or restricted by its author, replace it rather than reading the
// FAIL as a scraper bug (check the URL in a logged-out browser first).
import { scrapeViaEmbeddedJson } from '../src/lib/instagramJsonScraper';

type Check = { label: string; url: string; expect: 'post' | 'carousel' | 'restricted' };

const CHECKS: Check[] = [
  { label: 'Reel — briochettes (@mumandchef)', url: 'https://www.instagram.com/reel/DQE0go2CA2V/', expect: 'post' },
  { label: 'Reel — tarte cheesy crust (@charlie.ma.vie)', url: 'https://www.instagram.com/reel/DHvINGdM7XJ/', expect: 'post' },
  { label: 'Reel — tarte abricots (@cookandshine_)', url: 'https://www.instagram.com/reel/DbQkE0Nszh5/', expect: 'post' },
  { label: 'Photo post (@instagram)', url: 'https://www.instagram.com/p/Ddwoj5kBk9X/', expect: 'post' },
  { label: 'Carousel, 3 images (@instagram)', url: 'https://www.instagram.com/p/DdwalmrkTSK/', expect: 'carousel' },
  // Restricted to logged-in users: the JSON path must *not* find data here
  // (the app then falls back to the browser, which shows the dedicated
  // "restricted" message).
  { label: 'Restricted Reel (no data expected)', url: 'https://www.instagram.com/reel/DdeGvacRMab/', expect: 'restricted' },
];

async function main() {
  let failures = 0;
  for (const check of CHECKS) {
    const start = Date.now();
    const result = await scrapeViaEmbeddedJson(check.url);
    const ms = Date.now() - start;
    let ok: boolean;
    let detail: string;
    if (!result.ok) {
      ok = check.expect === 'restricted' && result.reason === 'no-media-json';
      detail = `no data (${result.reason})`;
    } else {
      const { caption, photo, photoCandidates } = result.post;
      const imageCount = photoCandidates?.length ?? (photo ? 1 : 0);
      ok =
        check.expect === 'post'
          ? Boolean(caption) && Boolean(photo)
          : check.expect === 'carousel'
            ? Boolean(photo) && imageCount > 1
            : false;
      detail = `caption ${caption ? `${caption.length} chars` : 'none'}, ${imageCount} image(s)`;
    }
    if (!ok) failures++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.label} — ${detail}, ${ms}ms`);
  }
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed — see NOTES.md for how to investigate.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
