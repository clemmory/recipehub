import { Client } from 'minio';

export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: false,
  accessKey: process.env.MINIO_ACCESS_KEY ?? '',
  secretKey: process.env.MINIO_SECRET_KEY ?? '',
});

export const RECIPE_PHOTO_BUCKET = process.env.MINIO_BUCKET ?? 'recipes';

export async function ensureBucket() {
  const exists = await minioClient.bucketExists(RECIPE_PHOTO_BUCKET).catch((err) => {
    console.error(`[minio] bucketExists("${RECIPE_PHOTO_BUCKET}") check failed:`, err);
    return false;
  });
  if (!exists) {
    console.log(`[minio] bucket "${RECIPE_PHOTO_BUCKET}" not found, creating it`);
    await minioClient.makeBucket(RECIPE_PHOTO_BUCKET);
  }
}
