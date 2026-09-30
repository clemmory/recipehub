import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { scrapeInstagramPost } from '../lib/instagramScraper';
import { structureRecipe, type StructuredRecipe } from '../lib/claude';
import { firstZodMessage } from '../lib/validation';
import { prisma } from '../lib/prisma';

const instagramSchema = z.object({
  url: z.string().url('Lien invalide'),
});

const structureSchema = z
  .object({
    caption: z.string().nullish(),
    photoBase64: z.string().nullish(),
    photoMimeType: z.string().nullish(),
  })
  .refine((data) => Boolean(data.caption) || Boolean(data.photoBase64), {
    message: 'Une légende ou une photo est requise',
  });

// Below this many characters, a caption can't hold a recipe on its own
// ("Recette en description 👇", "Tarte aux fraises 🍓 #dessert") — the post's
// photo is then sent to Claude too. Above it, the photo is left out: an
// Instagram cover shows the dish, not the recipe, and measured 2026-09-29
// (npm run bench:structure) sending it gave near-identical drafts while
// adding ~0.4s and 35-60% more input tokens.
const CAPTION_ENOUGH_CHARS = 150;

async function userTagNames(userId: string): Promise<string[]> {
  const tags = await prisma.tag.findMany({ where: { userId }, select: { name: true }, orderBy: { name: 'asc' } });
  return tags.map((t) => t.name);
}

export async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Instagram import in one call (2026-09-29): scrape, then structure with
  // Claude, server-side. Replaces POST /imports/scrape + a second
  // POST /imports/structure from the phone, which made the post's photo
  // travel server → phone → server as base64 just so Claude could see it
  // (slow on a mobile connection, and what hit the 413). Always replies 200:
  // a failed scrape or structuring is an expected case the app falls back on.
  app.post('/imports/instagram', async (req, reply) => {
    const parsed = instagramSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstZodMessage(parsed.error) });
    }

    const start = Date.now();
    const result = await scrapeInstagramPost(parsed.data.url);
    if (!result.ok) {
      return {
        scraped: false,
        // Drives the message ImportScreen shows:
        // - 'unavailable': page came back without this post's data —
        //   restricted to logged-in users or deleted, indistinguishable
        //   from here → "copy the caption by hand";
        // - 'bad-url': a valid URL but not an Instagram post link;
        // - 'failed': Instagram didn't answer properly (network, timeout,
        //   image download) → "try again".
        reason: result.reason === 'unavailable' || result.reason === 'bad-url' ? result.reason : 'failed',
        draft: null,
        caption: null,
        photoBase64: null,
        photoMimeType: null,
        photoCandidates: [],
      };
    }
    const scraped = result.post;
    const scrapeMs = Date.now() - start;

    // Structuring failures don't fail the import: the caption and photo are
    // still returned so the app can show them and offer a manual retry
    // ("Structurer avec l'IA", which goes through POST /imports/structure).
    let draft: StructuredRecipe | null = null;
    const sendPhoto = !scraped.caption || scraped.caption.length < CAPTION_ENOUGH_CHARS;
    try {
      draft = await structureRecipe({
        caption: scraped.caption ?? undefined,
        photo: sendPhoto ? scraped.photo : undefined,
        existingTags: await userTagNames(req.user.userId),
      });
      req.log.info(`[imports] structured tags: ${draft.tags.join(', ')}`);
    } catch (err) {
      req.log.error(err);
    }
    req.log.info(
      `[imports] instagram import: scrape ${scrapeMs}ms + structure ${Date.now() - start - scrapeMs}ms ` +
        `(photo ${sendPhoto ? 'sent, caption too short' : 'not sent'}), draft ${draft ? 'ok' : 'failed'}`,
    );

    return {
      scraped: true,
      reason: null,
      draft,
      caption: scraped.caption,
      photoBase64: scraped.photo.data.toString('base64'),
      photoMimeType: scraped.photo.mimeType,
      // Every image of a carousel (with `photo` = the first one), for the
      // user to pick from in RecipeEditScreen. Empty for a single image.
      photoCandidates: (scraped.photoCandidates ?? []).map((c) => ({
        photoBase64: c.data.toString('base64'),
        photoMimeType: c.mimeType,
        label: c.label,
      })),
    };
  });

  // Manual path: the user pasted a caption and/or added a photo themselves
  // (import failed, or a retry). The photo is always sent to Claude here —
  // it may well be the recipe itself (a cookbook page, a screenshot).
  // It arrives base64-encoded in the JSON body (~4/3 of the image size), so
  // Fastify's 1 MB default body limit is raised to the same 10 MB as the
  // recipe photo upload (app.ts) — a full-resolution photo hit a 413 on
  // 2026-09-29.
  app.post('/imports/structure', { bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const parsed = structureSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstZodMessage(parsed.error) });
    }
    const { caption, photoBase64, photoMimeType } = parsed.data;

    try {
      const existingTags = await userTagNames(req.user.userId);
      req.log.info(`[imports] structuring with ${existingTags.length} existing tag(s) as context`);
      const draft = await structureRecipe({
        caption: caption ?? undefined,
        photo: photoBase64 ? { data: Buffer.from(photoBase64, 'base64'), mimeType: photoMimeType ?? 'image/jpeg' } : undefined,
        existingTags,
      });
      req.log.info(`[imports] structured tags: ${draft.tags.join(', ')}`);
      return draft;
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: "Impossible de structurer la recette avec l'IA" });
    }
  });
}
