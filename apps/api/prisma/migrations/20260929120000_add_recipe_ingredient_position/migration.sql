-- Ingredients had no stored order: RecipeIngredient rows came back in
-- arbitrary DB order, shuffling a recipe's ingredient list and interleaving
-- its sections (e.g. "Pour le fond de tarte" / "Pour la crème de féta" /
-- "Pour le fond de tarte" again) — found 2026-09-29 on an imported recipe,
-- see NOTES.md. Existing rows get 0 (their original order is lost); new and
-- re-saved recipes store their list index.
ALTER TABLE "recipe_ingredients" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
