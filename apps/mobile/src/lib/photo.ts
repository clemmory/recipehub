import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

// Claude scales any image down to ~1568px on its long edge anyway, so
// sending more only costs upload time: a 12 MP phone photo is ~3 MB, ~4 MB
// once base64-encoded, times up to 5 pages for a photo import.
const AI_MAX_EDGE = 1568;

export type AiPhoto = { uri: string; base64: string; mimeType: string };

// Resizes a picked/taken photo for the AI (long edge ≤ AI_MAX_EDGE, JPEG)
// and returns it with its base64, ready for the import request.
export async function preparePhotoForAi(asset: { uri: string; width: number; height: number }): Promise<AiPhoto> {
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > AI_MAX_EDGE) {
    context.resize(asset.width >= asset.height ? { width: AI_MAX_EDGE } : { height: AI_MAX_EDGE });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!result.base64) throw new Error('Photo illisible');
  console.log(
    `[photo] prepared for AI: ${asset.width}x${asset.height} -> ${result.width}x${result.height}, ` +
      `${Math.round((result.base64.length * 3) / 4 / 1024)}KB`,
  );
  return { uri: result.uri, base64: result.base64, mimeType: 'image/jpeg' };
}

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
