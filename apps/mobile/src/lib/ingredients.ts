// Reorders an ingredient list so each section's items sit together:
// ingredients without a section first (same convention as the edit
// screen's "add ingredient"), then every section in the order it first
// appears, each keeping its items' original relative order.
//
// Added 2026-09-29: both screens only group *consecutive* same-section
// items, so an interleaved list ("fond de tarte", "crème de féta", "fond de
// tarte" again...) repeated the section title for every switch. The API now
// stores and returns ingredients in their saved order (`position`), but
// recipes saved before that come back in arbitrary order — this keeps them
// readable too, and guards against an AI draft that interleaves sections.
export function groupBySection<T extends { section: string | null }>(items: T[]): T[] {
  const key = (section: string | null) => section?.trim().toLowerCase() ?? '';
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item.section);
    if (!buckets.has(k)) {
      buckets.set(k, []);
      order.push(k);
    }
    buckets.get(k)!.push(item);
  }
  // No-section bucket ('') first, the rest in first-appearance order.
  order.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
  return order.flatMap((k) => buckets.get(k)!);
}
