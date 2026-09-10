-- Drop the old exact-name uniqueness (case/plural sensitive)
DROP INDEX "ingredients_name_key";
DROP INDEX "tags_name_key";

-- Add normalized column, nullable at first so we can backfill existing rows
ALTER TABLE "ingredients" ADD COLUMN "normalized" TEXT;
ALTER TABLE "tags" ADD COLUMN "normalized" TEXT;

-- Backfill: lowercase + strip a naive trailing French plural "s"
-- (kept in sync with normalizeWord() in src/routes/recipes.ts)
UPDATE "ingredients" SET "normalized" = (
  CASE
    WHEN length(trim(lower(name))) > 3
      AND trim(lower(name)) LIKE '%s'
      AND trim(lower(name)) NOT LIKE '%ss'
    THEN left(trim(lower(name)), length(trim(lower(name))) - 1)
    ELSE trim(lower(name))
  END
);

UPDATE "tags" SET "normalized" = (
  CASE
    WHEN length(trim(lower(name))) > 3
      AND trim(lower(name)) LIKE '%s'
      AND trim(lower(name)) NOT LIKE '%ss'
    THEN left(trim(lower(name)), length(trim(lower(name))) - 1)
    ELSE trim(lower(name))
  END
);

-- Now that every row has a value, enforce NOT NULL + uniqueness
ALTER TABLE "ingredients" ALTER COLUMN "normalized" SET NOT NULL;
ALTER TABLE "tags" ALTER COLUMN "normalized" SET NOT NULL;

CREATE UNIQUE INDEX "ingredients_normalized_key" ON "ingredients"("normalized");
CREATE UNIQUE INDEX "tags_normalized_key" ON "tags"("normalized");
