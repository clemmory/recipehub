-- Ingredient and Tag were a single global vocabulary shared across ALL
-- user accounts (no userId column at all). Discovered as a real gap once
-- a second account existed for testing: editing/renaming a tag or
-- ingredient in one account's recipe silently changed it for every other
-- account sharing the same row (find-or-create matches globally on
-- "normalized"). Scope both by user so each account has its own private
-- vocabulary, matching how Recipe already works.

-- 1. Add nullable userId columns first, backfill, then enforce NOT NULL.
ALTER TABLE "ingredients" ADD COLUMN "userId" TEXT;
ALTER TABLE "tags" ADD COLUMN "userId" TEXT;

-- 2. Backfill rows referenced by exactly one user's recipes (the common
-- case — a row only ever used by one account).
UPDATE "ingredients" i
SET "userId" = sub.uid
FROM (
  SELECT ri."ingredientId" AS id, MIN(r."userId") AS uid
  FROM "recipe_ingredients" ri
  JOIN "recipes" r ON r.id = ri."recipeId"
  GROUP BY ri."ingredientId"
  HAVING COUNT(DISTINCT r."userId") = 1
) sub
WHERE sub.id = i.id;

UPDATE "tags" t
SET "userId" = sub.uid
FROM (
  SELECT rt."tagId" AS id, MIN(r."userId") AS uid
  FROM "recipe_tags" rt
  JOIN "recipes" r ON r.id = rt."recipeId"
  GROUP BY rt."tagId"
  HAVING COUNT(DISTINCT r."userId") = 1
) sub
WHERE sub.id = t.id;

-- 3. Rows referenced by MORE THAN ONE user must be split: the original
-- row stays with the first user (earliest by userId), and a fresh
-- duplicate row is created per additional user, repointing that user's
-- join rows to the new copy so nobody's data moves or disappears.
-- Drop the old *global* uniqueness on "normalized" first — it would
-- otherwise reject inserting a duplicate row with the same normalized
-- value for a different user (that's the whole point of the split).
DROP INDEX "ingredients_normalized_key";
DROP INDEX "tags_normalized_key";

DO $$
DECLARE
  row RECORD;
  extra_user RECORD;
  new_id TEXT;
BEGIN
  FOR row IN
    SELECT ri."ingredientId" AS id, MIN(r."userId") AS first_uid
    FROM "recipe_ingredients" ri
    JOIN "recipes" r ON r.id = ri."recipeId"
    GROUP BY ri."ingredientId"
    HAVING COUNT(DISTINCT r."userId") > 1
  LOOP
    UPDATE "ingredients" SET "userId" = row.first_uid WHERE id = row.id;

    FOR extra_user IN
      SELECT DISTINCT r."userId" AS uid
      FROM "recipe_ingredients" ri
      JOIN "recipes" r ON r.id = ri."recipeId"
      WHERE ri."ingredientId" = row.id AND r."userId" != row.first_uid
    LOOP
      new_id := gen_random_uuid()::text;
      INSERT INTO "ingredients" (id, name, normalized, "createdAt", "userId")
      SELECT new_id, name, normalized, "createdAt", extra_user.uid
      FROM "ingredients" WHERE id = row.id;

      UPDATE "recipe_ingredients" ri
      SET "ingredientId" = new_id
      FROM "recipes" r
      WHERE ri."recipeId" = r.id AND ri."ingredientId" = row.id AND r."userId" = extra_user.uid;
    END LOOP;
  END LOOP;

  FOR row IN
    SELECT rt."tagId" AS id, MIN(r."userId") AS first_uid
    FROM "recipe_tags" rt
    JOIN "recipes" r ON r.id = rt."recipeId"
    GROUP BY rt."tagId"
    HAVING COUNT(DISTINCT r."userId") > 1
  LOOP
    UPDATE "tags" SET "userId" = row.first_uid WHERE id = row.id;

    FOR extra_user IN
      SELECT DISTINCT r."userId" AS uid
      FROM "recipe_tags" rt
      JOIN "recipes" r ON r.id = rt."recipeId"
      WHERE rt."tagId" = row.id AND r."userId" != row.first_uid
    LOOP
      new_id := gen_random_uuid()::text;
      INSERT INTO "tags" (id, name, normalized, "createdAt", "userId")
      SELECT new_id, name, normalized, "createdAt", extra_user.uid
      FROM "tags" WHERE id = row.id;

      UPDATE "recipe_tags" rt
      SET "tagId" = new_id
      FROM "recipes" r
      WHERE rt."recipeId" = r.id AND rt."tagId" = row.id AND r."userId" = extra_user.uid;
    END LOOP;
  END LOOP;
END $$;

-- 4. Remaining rows have no recipe referencing them at all (leftover
-- vocabulary from edits that dropped an ingredient/tag) — not tied to
-- any user and never displayed anywhere, so delete rather than guess an
-- owner.
DELETE FROM "ingredients" WHERE "userId" IS NULL;
DELETE FROM "tags" WHERE "userId" IS NULL;

-- 5. Enforce NOT NULL + FK, and add the new per-user unique constraint
-- (the old global one on "normalized" alone was already dropped in
-- step 3, before the split could insert its duplicate rows).
ALTER TABLE "ingredients" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "tags" ALTER COLUMN "userId" SET NOT NULL;

CREATE UNIQUE INDEX "ingredients_userId_normalized_key" ON "ingredients"("userId", "normalized");
CREATE UNIQUE INDEX "tags_userId_normalized_key" ON "tags"("userId", "normalized");

ALTER TABLE "ingredients" ADD CONSTRAINT "ingredients_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tags" ADD CONSTRAINT "tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
