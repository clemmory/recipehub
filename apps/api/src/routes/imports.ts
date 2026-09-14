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

    const scraped = await scrapeInstagramPost(parsed.data.url);
    if (!scraped) {
      return { scraped: false, caption: null, photoBase64: null, photoMimeType: null };
    }

    return {
      scraped: true,
      caption: scraped.caption,
      photoBase64: scraped.photo ? scraped.photo.data.toString('base64') : null,
      photoMimeType: scraped.photo?.mimeType ?? null,
    };
  });

  app.post('/imports/structure', async (req, reply) => {
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
