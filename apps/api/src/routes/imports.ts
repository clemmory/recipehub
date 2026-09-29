import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { scrapeInstagramPost } from '../lib/instagramScraper';
import { structureRecipe } from '../lib/claude';
import { firstZodMessage } from '../lib/validation';
import { prisma } from '../lib/prisma';

const scrapeSchema = z.object({
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

export async function importRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.post('/imports/scrape', async (req, reply) => {
    const parsed = scrapeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstZodMessage(parsed.error) });
    }

    const result = await scrapeInstagramPost(parsed.data.url);
    if (!result.ok) {
      return {
        scraped: false,
        // Drives the message ImportScreen shows (2026-09-29, a message per
        // case instead of one generic "impossible"):
        // - 'unavailable': page came back without this post's data —
        //   restricted to logged-in users or deleted, indistinguishable
        //   from here → "copy the caption by hand";
        // - 'bad-url': a valid URL but not an Instagram post link;
        // - 'failed': Instagram didn't answer properly (network, timeout,
        //   image download) → "try again".
        reason: result.reason === 'unavailable' || result.reason === 'bad-url' ? result.reason : 'failed',
        caption: null,
        photoBase64: null,
        photoMimeType: null,
        photoCandidates: [],
      };
    }

    const scraped = result.post;
    return {
      scraped: true,
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

  // The photo arrives base64-encoded in the JSON body (~4/3 of the image
  // size). Fastify's default 1 MB body limit rejected full-resolution Reel
  // covers with a 413 once the scraper started returning them (2026-09-29)
  // — raised to the same 10 MB as the recipe photo upload (app.ts).
  app.post('/imports/structure', { bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
    const parsed = structureSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstZodMessage(parsed.error) });
    }
    const { caption, photoBase64, photoMimeType } = parsed.data;

    try {
      const existingTags = await prisma.tag.findMany({
        where: { userId: req.user.userId },
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      req.log.info(`[imports] structuring with ${existingTags.length} existing tag(s) as context`);
      const draft = await structureRecipe({
        caption: caption ?? undefined,
        photo: photoBase64 ? { data: Buffer.from(photoBase64, 'base64'), mimeType: photoMimeType ?? 'image/jpeg' } : undefined,
        existingTags: existingTags.map((t) => t.name),
      });
      req.log.info(`[imports] structured tags: ${draft.tags.join(', ')}`);
      return draft;
    } catch (err) {
      req.log.error(err);
      return reply.code(502).send({ error: "Impossible de structurer la recette avec l'IA" });
    }
  });
}
