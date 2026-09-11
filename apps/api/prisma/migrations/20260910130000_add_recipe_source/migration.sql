-- Free-text, nullable "source" field on Recipe (design decision 2026-09-08,
-- see NOTES.md/CONCEPTION.md §1): no enum, just a string — could be an
-- Instagram/web link, a book photo caption, or a person's name. Detected as a
-- clickable link on display only if it looks like a URL.
ALTER TABLE "recipes" ADD COLUMN "source" TEXT;
