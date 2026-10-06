import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

export type StructuredRecipe = {
  title: string;
  ingredients: { name: string; quantity: string | null; section: string | null }[];
  steps: string[];
  prepTimeMin: number | null;
  cookTimeMin: number | null;
  servings: number | null;
  tags: string[];
};

const RECORD_RECIPE_TOOL: Anthropic.Tool = {
  name: 'record_recipe',
  description: 'Records the recipe structured from the provided caption and/or photo.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'ingredients', 'steps', 'prepTimeMin', 'cookTimeMin', 'servings', 'tags'],
    properties: {
      title: {
        type: 'string',
        description:
          'Short dish name, 40 characters max, e.g. "Tarte abricots & amande" — not the post\'s catchy headline ("La meilleure tarte aux abricots de l\'été, ultra fondante..."). It must fit on two lines of a small recipe card.',
      },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'quantity', 'section'],
          properties: {
            name: { type: 'string' },
            quantity: { type: ['string', 'null'], description: 'e.g. "200g", "2", null if unknown' },
            section: {
              type: ['string', 'null'],
              description:
                'Which part of the recipe this ingredient belongs to, e.g. "Pour la pâte", "Pour la crème", "Pour la garniture" — only when the recipe genuinely has distinct parts. null if the recipe has no such parts. The SAME ingredient may legitimately appear more than once with a different section and quantity each time (e.g. butter in both the dough and the cream) — list it once per part rather than merging into a single quantity.',
            },
          },
        },
      },
      steps: { type: 'array', items: { type: 'string' } },
      prepTimeMin: { type: ['integer', 'null'] },
      cookTimeMin: { type: ['integer', 'null'] },
      servings: { type: ['integer', 'null'] },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description:
          'e.g. "Dessert", "Facile", "Végétarien". Reuse one of the user\'s existing tags (given in the prompt) whenever it fits, instead of inventing a near-duplicate (e.g. "Rapide" already exists — don\'t also produce "Facile" or "Vite fait" for the same idea).',
      },
    },
  },
};

const SYSTEM_PROMPT =
  'Tu extrais une recette de cuisine structurée à partir de la légende et/ou de la photo ' +
  "fournie par l'utilisateur (post Instagram, livre de recettes...). Réponds en français, " +
  "même si le texte source est dans une autre langue. N'invente rien : si une information " +
  '(temps, portions, quantité) est absente, mets null plutôt que de la deviner. Utilise ' +
  "l'outil record_recipe pour renvoyer le résultat.";

function log(message: string): void {
  console.log(`[claude] ${message}`);
}

export async function structureRecipe(
  input: {
    caption?: string;
    // Several photos = the pages of one recipe, in order (a cookbook recipe
    // spread over two pages — photo import, 2026-09-30). Instagram sends at
    // most one.
    photos?: { data: Buffer; mimeType: string }[];
    existingTags?: string[];
  },
  // Overrides used by scripts/bench-structure.ts to compare configurations.
  options: { model?: string } = {},
): Promise<StructuredRecipe> {
  const model = options.model ?? MODEL;
  const content: Anthropic.ContentBlockParam[] = [];

  const photos = input.photos ?? [];
  for (const photo of photos) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: photo.mimeType as 'image/jpeg', data: photo.data.toString('base64') },
    });
  }
  if (photos.length > 1) {
    content.push({
      type: 'text',
      text: `Ces ${photos.length} photos sont les pages successives d'une seule et même recette, dans l'ordre : combine-les en une seule recette.`,
    });
  }
  content.push({
    type: 'text',
    text: input.caption
      ? `Légende :\n${input.caption}`
      : `Aucune légende fournie, base-toi uniquement sur ${photos.length > 1 ? 'les photos' : 'la photo'}.`,
  });
  if (input.existingTags && input.existingTags.length > 0) {
    content.push({
      type: 'text',
      text: `Tags déjà utilisés par l'utilisateur (réutilise-les en priorité si pertinents plutôt que d'en inventer des proches) :\n${input.existingTags.join(', ')}`,
    });
  }

  const start = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    // `effort` isn't accepted by Haiku 4.5 (400) — only sent to the models
    // that support it.
    ...(model.startsWith('claude-haiku') ? {} : { output_config: { effort: 'low' as const } }),
    tools: [RECORD_RECIPE_TOOL],
    tool_choice: { type: 'tool', name: 'record_recipe' },
    messages: [{ role: 'user', content }],
  });
  // Timing + token usage on every call (2026-09-29): the Claude step became
  // the slowest part of an import once scraping dropped to ~1.5s, and
  // nothing showed where its 8-11s went.
  log(
    `${model}: ${Date.now() - start}ms, input ${response.usage.input_tokens} tokens, ` +
      `output ${response.usage.output_tokens} tokens, ${photos.length} photo(s) sent, stop ${response.stop_reason}`,
  );

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error("Claude n'a pas renvoyé de recette structurée");
  }
  return toolUse.input as StructuredRecipe;
}
