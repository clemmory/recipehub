// Benchmark for the Claude structuring step — `npm run bench:structure`
// (repo root or apps/api). Added 2026-09-29 to decide how to speed up the
// import's Claude step (8-11s, vs ~1.5s for scraping).
//
// ⚠ Calls the Claude API for real and spends money on ANTHROPIC_API_KEY
// (~$0.30 for the default run: 3 posts × 4 configs × 2 runs). Scrapes each
// reference post once, then structures its caption with every
// configuration below, and writes the drafts to bench-structure-results.json
// (next to this script, gitignored) to compare quality side by side.
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import { scrapeInstagramPost } from '../src/lib/instagramScraper';
import { structureRecipe, type StructuredRecipe } from '../src/lib/claude';

const POSTS = [
  { label: 'briochettes', url: 'https://www.instagram.com/reel/DQE0go2CA2V/' },
  { label: 'tarte cheesy crust', url: 'https://www.instagram.com/reel/DHvINGdM7XJ/' },
  { label: 'tarte abricots', url: 'https://www.instagram.com/reel/DbQkE0Nszh5/' },
];
const CONFIGS = [
  { label: 'sonnet-5 + photo', model: 'claude-sonnet-5', withPhoto: true },
  { label: 'sonnet-5 caption only', model: 'claude-sonnet-5', withPhoto: false },
  { label: 'haiku-4-5 + photo', model: 'claude-haiku-4-5', withPhoto: true },
  { label: 'haiku-4-5 caption only', model: 'claude-haiku-4-5', withPhoto: false },
];
const RUNS = 2;
// A realistic tag vocabulary (the structuring prompt includes the user's
// existing tags as context).
const EXISTING_TAGS = ['Apéro', 'Dessert', 'Facile', 'Indien', 'Plat', 'Rapide', 'Tarte', 'Végétarien'];

type Row = { post: string; config: string; run: number; ms: number; ok: boolean; draft?: StructuredRecipe; error?: string };

async function main() {
  const rows: Row[] = [];
  for (const post of POSTS) {
    const scraped = await scrapeInstagramPost(post.url);
    if (!scraped.ok) {
      console.log(`SKIP ${post.label}: scrape failed (${scraped.reason})`);
      continue;
    }
    for (const config of CONFIGS) {
      for (let run = 1; run <= RUNS; run++) {
        const start = Date.now();
        try {
          const draft = await structureRecipe(
            {
              caption: scraped.post.caption ?? undefined,
              photo: config.withPhoto ? scraped.post.photo : undefined,
              existingTags: EXISTING_TAGS,
            },
            { model: config.model },
          );
          rows.push({ post: post.label, config: config.label, run, ms: Date.now() - start, ok: true, draft });
        } catch (err) {
          rows.push({ post: post.label, config: config.label, run, ms: Date.now() - start, ok: false, error: (err as Error).message });
        }
      }
    }
  }

  console.log('\nAverage time per config:');
  for (const config of CONFIGS) {
    const mine = rows.filter((r) => r.config === config.label && r.ok);
    const avg = mine.length ? Math.round(mine.reduce((s, r) => s + r.ms, 0) / mine.length) : NaN;
    console.log(`  ${config.label.padEnd(24)} ${avg}ms  (${mine.length} ok / ${rows.filter((r) => r.config === config.label).length})`);
  }
  const out = path.join(path.resolve('scripts'), 'bench-structure-results.json');
  fs.writeFileSync(out, JSON.stringify(rows, null, 2));
  console.log(`\nDrafts written to ${out}`);
}

main();
