import type { FastifyInstance } from 'fastify';
import type { MultipartFile } from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { minioClient, RECIPE_PHOTO_BUCKET } from '../lib/minio';
import { firstZodMessage } from '../lib/validation';

const numberField = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? undefined : Number(v)),
  z.number().int().positive().optional(),
);

const recipeFieldsSchema = z.object({
  title: z.string().min(1, 'Le titre est obligatoire'),
  prepTimeMin: numberField,
  cookTimeMin: numberField,
  servings: numberField,
});

const ingredientsSchema = z
  .array(z.object({ name: z.string().min(1, "Le nom de l'ingrédient est obligatoire"), quantity: z.string().nullish() }))
  .min(1, 'Au moins un ingrédient est requis');
const stepsSchema = z.array(z.string().min(1, "L'étape ne peut pas être vide")).min(1, 'Au moins une étape est requise');
const tagsSchema = z.array(z.string().min(1, 'Le tag ne peut pas être vide')).default([]);

// Case-insensitive matching only for ingredient & tag find-or-create, so
// "Tomate" and "tomate" resolve to the same row. Deliberately NOT
// plural-insensitive (dropped 2026-09-10, see NOTES.md) — "tomate" and
// "tomates" are kept as distinct ingredients, since the singular/plural
// often carries real meaning (quantity agreement), not just a spelling
// slip. A future ingredient search is expected to match by prefix/contains
// rather than exact equality, so having both forms isn't a problem there.
function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

function isMultipartFile(value: unknown): value is MultipartFile {
  return typeof value === 'object' && value !== null && (value as { type?: string }).type === 'file';
}

function parseJsonField<S extends z.ZodTypeAny>(
  raw: unknown,
  schema: S,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'champ manquant' };
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success) return { ok: false, error: firstZodMessage(parsed.error) };
    return { ok: true, data: parsed.data };
  } catch {
    return { ok: false, error: 'JSON invalide' };
  }
}

const recipeListSelect = {
  id: true,
  title: true,
  prepTimeMin: true,
  cookTimeMin: true,
  servings: true,
  photoKey: true,
  createdAt: true,
  tags: { include: { tag: true } },
} as const;

const recipeDetailInclude = {
  ingredients: { include: { ingredient: true } },
  tags: { include: { tag: true } },
} as const;

function serializeSummary(recipe: {
  id: string;
  title: string;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number | null;
  photoKey: string | null;
  createdAt: Date;
  tags: { tag: { name: string } }[];
}) {
  return {
    id: recipe.id,
    title: recipe.title,
    prepTimeMin: recipe.prepTimeMin,
    cookTimeMin: recipe.cookTimeMin,
    servings: recipe.servings,
    tags: recipe.tags.map((rt) => rt.tag.name),
    photoUrl: recipe.photoKey ? `/recipes/${recipe.id}/photo?v=${encodeURIComponent(recipe.photoKey)}` : null,
    createdAt: recipe.createdAt,
  };
}

function serializeDetail(recipe: {
  id: string;
  title: string;
  steps: unknown;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number | null;
  photoKey: string | null;
  createdAt: Date;
  updatedAt: Date;
  ingredients: { quantity: string | null; ingredient: { name: string } }[];
  tags: { tag: { name: string } }[];
}) {
  return {
    id: recipe.id,
    title: recipe.title,
    steps: recipe.steps as string[],
    prepTimeMin: recipe.prepTimeMin,
    cookTimeMin: recipe.cookTimeMin,
    servings: recipe.servings,
    photoUrl: recipe.photoKey ? `/recipes/${recipe.id}/photo?v=${encodeURIComponent(recipe.photoKey)}` : null,
    ingredients: recipe.ingredients.map((ri) => ({ name: ri.ingredient.name, quantity: ri.quantity })),
    tags: recipe.tags.map((rt) => rt.tag.name),
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

async function uploadPhoto(recipeId: string, file: MultipartFile) {
  const buffer = await file.toBuffer();
  const key = `${recipeId}/${randomUUID()}-${file.filename}`;
  await minioClient.putObject(RECIPE_PHOTO_BUCKET, key, buffer, buffer.length, {
    'Content-Type': file.mimetype,
  });
  return key;
}

async function deletePhoto(key: string) {
  await minioClient.removeObject(RECIPE_PHOTO_BUCKET, key).catch(() => undefined);
}

export async function recipeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/recipes', async (req) => {
    const recipes = await prisma.recipe.findMany({
      where: { userId: req.user.userId },
      select: recipeListSelect,
      orderBy: { createdAt: 'desc' },
    });
    return recipes.map(serializeSummary);
  });

  app.get<{ Params: { id: string } }>('/recipes/:id', async (req, reply) => {
    const recipe = await prisma.recipe.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
      include: recipeDetailInclude,
    });
    if (!recipe) return reply.code(404).send({ error: 'Recette introuvable' });
    return serializeDetail(recipe);
  });

  app.get<{ Params: { id: string } }>('/recipes/:id/photo', async (req, reply) => {
    const recipe = await prisma.recipe.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
    if (!recipe || !recipe.photoKey) return reply.code(404).send({ error: 'Photo introuvable' });

    const stat = await minioClient.statObject(RECIPE_PHOTO_BUCKET, recipe.photoKey).catch(() => null);
    const stream = await minioClient.getObject(RECIPE_PHOTO_BUCKET, recipe.photoKey);
    reply.type(stat?.metaData?.['content-type'] ?? 'application/octet-stream');
    return reply.send(stream);
  });

  app.post('/recipes', async (req, reply) => {
    const body = req.body as Record<string, unknown>;

    const fields = recipeFieldsSchema.safeParse({
      title: (body.title as { value?: string })?.value,
      prepTimeMin: (body.prepTimeMin as { value?: string })?.value,
      cookTimeMin: (body.cookTimeMin as { value?: string })?.value,
      servings: (body.servings as { value?: string })?.value,
    });
    if (!fields.success) return reply.code(400).send({ error: firstZodMessage(fields.error) });

    const steps = parseJsonField((body.steps as { value?: string })?.value, stepsSchema);
    if (!steps.ok) return reply.code(400).send({ error: `étapes : ${steps.error}` });

    const ingredients = parseJsonField((body.ingredients as { value?: string })?.value ?? '[]', ingredientsSchema);
    if (!ingredients.ok) return reply.code(400).send({ error: `ingrédients : ${ingredients.error}` });

    const tags = parseJsonField((body.tags as { value?: string })?.value ?? '[]', tagsSchema);
    if (!tags.ok) return reply.code(400).send({ error: `tags : ${tags.error}` });

    const photoFile = isMultipartFile(body.photo) ? body.photo : undefined;

    const recipe = await prisma.$transaction(async (tx) => {
      const created = await tx.recipe.create({
        data: {
          title: fields.data.title,
          steps: steps.data,
          prepTimeMin: fields.data.prepTimeMin,
          cookTimeMin: fields.data.cookTimeMin,
          servings: fields.data.servings,
          userId: req.user.userId,
        },
      });

      for (const item of ingredients.data) {
        const ingredient = await tx.ingredient.upsert({
          where: { userId_normalized: { userId: req.user.userId, normalized: normalizeWord(item.name) } },
          create: { name: item.name, normalized: normalizeWord(item.name), userId: req.user.userId },
          update: { name: item.name },
        });
        await tx.recipeIngredient.create({
          data: { recipeId: created.id, ingredientId: ingredient.id, quantity: item.quantity },
        });
      }

      for (const name of tags.data) {
        const tag = await tx.tag.upsert({
          where: { userId_normalized: { userId: req.user.userId, normalized: normalizeWord(name) } },
          create: { name, normalized: normalizeWord(name), userId: req.user.userId },
          update: { name },
        });
        await tx.recipeTag.create({ data: { recipeId: created.id, tagId: tag.id } });
      }

      return created;
    });

    if (photoFile) {
      const key = await uploadPhoto(recipe.id, photoFile);
      await prisma.recipe.update({ where: { id: recipe.id }, data: { photoKey: key } });
    }

    const full = await prisma.recipe.findUniqueOrThrow({ where: { id: recipe.id }, include: recipeDetailInclude });
    return reply.code(201).send(serializeDetail(full));
  });

  app.put<{ Params: { id: string } }>('/recipes/:id', async (req, reply) => {
    const existing = await prisma.recipe.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
    if (!existing) return reply.code(404).send({ error: 'Recette introuvable' });

    const body = req.body as Record<string, unknown>;

    const fields = recipeFieldsSchema.safeParse({
      title: (body.title as { value?: string })?.value,
      prepTimeMin: (body.prepTimeMin as { value?: string })?.value,
      cookTimeMin: (body.cookTimeMin as { value?: string })?.value,
      servings: (body.servings as { value?: string })?.value,
    });
    if (!fields.success) return reply.code(400).send({ error: firstZodMessage(fields.error) });

    const steps = parseJsonField((body.steps as { value?: string })?.value, stepsSchema);
    if (!steps.ok) return reply.code(400).send({ error: `étapes : ${steps.error}` });

    const ingredients = parseJsonField((body.ingredients as { value?: string })?.value ?? '[]', ingredientsSchema);
    if (!ingredients.ok) return reply.code(400).send({ error: `ingrédients : ${ingredients.error}` });

    const tags = parseJsonField((body.tags as { value?: string })?.value ?? '[]', tagsSchema);
    if (!tags.ok) return reply.code(400).send({ error: `tags : ${tags.error}` });

    const photoFile = isMultipartFile(body.photo) ? body.photo : undefined;
    const removePhoto = (body.removePhoto as { value?: string })?.value === 'true';

    await prisma.$transaction(async (tx) => {
      await tx.recipe.update({
        where: { id: existing.id },
        data: {
          title: fields.data.title,
          steps: steps.data,
          prepTimeMin: fields.data.prepTimeMin,
          cookTimeMin: fields.data.cookTimeMin,
          servings: fields.data.servings,
        },
      });

      await tx.recipeIngredient.deleteMany({ where: { recipeId: existing.id } });
      await tx.recipeTag.deleteMany({ where: { recipeId: existing.id } });

      for (const item of ingredients.data) {
        const ingredient = await tx.ingredient.upsert({
          where: { userId_normalized: { userId: req.user.userId, normalized: normalizeWord(item.name) } },
          create: { name: item.name, normalized: normalizeWord(item.name), userId: req.user.userId },
          update: { name: item.name },
        });
        await tx.recipeIngredient.create({
          data: { recipeId: existing.id, ingredientId: ingredient.id, quantity: item.quantity },
        });
      }

      for (const name of tags.data) {
        const tag = await tx.tag.upsert({
          where: { userId_normalized: { userId: req.user.userId, normalized: normalizeWord(name) } },
          create: { name, normalized: normalizeWord(name), userId: req.user.userId },
          update: { name },
        });
        await tx.recipeTag.create({ data: { recipeId: existing.id, tagId: tag.id } });
      }
    });

    if (photoFile) {
      if (existing.photoKey) await deletePhoto(existing.photoKey);
      const key = await uploadPhoto(existing.id, photoFile);
      await prisma.recipe.update({ where: { id: existing.id }, data: { photoKey: key } });
    } else if (removePhoto && existing.photoKey) {
      await deletePhoto(existing.photoKey);
      await prisma.recipe.update({ where: { id: existing.id }, data: { photoKey: null } });
    }

    const full = await prisma.recipe.findUniqueOrThrow({ where: { id: existing.id }, include: recipeDetailInclude });
    return serializeDetail(full);
  });

  app.delete<{ Params: { id: string } }>('/recipes/:id', async (req, reply) => {
    const existing = await prisma.recipe.findFirst({ where: { id: req.params.id, userId: req.user.userId } });
    if (!existing) return reply.code(404).send({ error: 'Recette introuvable' });

    await prisma.recipe.delete({ where: { id: existing.id } });
    if (existing.photoKey) await deletePhoto(existing.photoKey);

    return reply.code(204).send();
  });
}
