-- Same ingredient can legitimately appear twice in one recipe with two
-- different quantities (e.g. "beurre" for the dough AND for the cream) —
-- real case hit 2026-09-11 (see NOTES.md), previously crashed the whole
-- save with a unique constraint violation since RecipeIngredient only
-- allowed one row per (recipe, ingredient) regardless of purpose.
ALTER TABLE "recipe_ingredients" ADD COLUMN "section" TEXT;

DROP INDEX "recipe_ingredients_recipeId_ingredientId_key";

CREATE UNIQUE INDEX "recipe_ingredients_recipeId_ingredientId_section_key" ON "recipe_ingredients"("recipeId", "ingredientId", "section");
