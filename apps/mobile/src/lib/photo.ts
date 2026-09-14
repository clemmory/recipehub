import { File, Paths } from 'expo-file-system';

// The recipe save endpoint needs a real file:// uri as a multipart file
// part — a base64 payload (from a scrape/import preview) isn't usable
// as-is, so write it to a cache file first.
export function saveBase64PhotoToFile(base64: string, mimeType: string): { uri: string; name: string; type: string } {
  const extension = mimeType.split('/')[1] ?? 'jpg';
  const file = new File(Paths.cache, `photo-${Date.now()}.${extension}`);
  file.create();
  file.write(base64, { encoding: 'base64' });
  return { uri: file.uri, name: file.name, type: mimeType };
}
