import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

export type StructuredRecipe = {
  title: string;
  ingredients: { name: string; quantity: string | null }[];
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
      title: { type: 'string' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'quantity'],
          properties: {
            name: { type: 'string' },
            quantity: { type: ['string', 'null'], description: 'e.g. "200g", "2", null if unknown' },
          },
        },
      },
      steps: { type: 'array', items: { type: 'string' } },
      prepTimeMin: { type: ['integer', 'null'] },
      cookTimeMin: { type: ['integer', 'null'] },
      servings: { type: ['integer', 'null'] },
      tags: { type: 'array', items: { type: 'string' }, description: 'e.g. "Dessert", "Facile", "Végétarien"' },
    },
  },
};

const SYSTEM_PROMPT =
  'Tu extrais une recette de cuisine structurée à partir de la légende et/ou de la photo ' +
  "fournie par l'utilisateur (post Instagram, livre de recettes...). Réponds en français, " +
  "même si le texte source est dans une autre langue. N'invente rien : si une information " +
  '(temps, portions, quantité) est absente, mets null plutôt que de la deviner. Utilise ' +
  "l'outil record_recipe pour renvoyer le résultat.";

export async function structureRecipe(input: {
  caption?: string;
  photo?: { data: Buffer; mimeType: string };
}): Promise<StructuredRecipe> {
  const content: Anthropic.ContentBlockParam[] = [];

  if (input.photo) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: input.photo.mimeType as 'image/jpeg', data: input.photo.data.toString('base64') },
    });
  }
  content.push({
    type: 'text',
    text: input.caption ? `Légende :\n${input.caption}` : 'Aucune légende fournie, base-toi uniquement sur la photo.',
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    output_config: { effort: 'low' },
    tools: [RECORD_RECIPE_TOOL],
    tool_choice: { type: 'tool', name: 'record_recipe' },
    messages: [{ role: 'user', content }],
  });

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    throw new Error("Claude n'a pas renvoyé de recette structurée");
  }
  return toolUse.input as StructuredRecipe;
}
