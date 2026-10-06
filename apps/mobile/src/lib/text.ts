// Accent- and case-insensitive form of a string, for matching only (never
// displayed): "Gâteau" → "gateau", so typing "gat" finds it.
export function foldText(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function matchesSearch(text: string, query: string) {
  return foldText(text).includes(foldText(query.trim()));
}
