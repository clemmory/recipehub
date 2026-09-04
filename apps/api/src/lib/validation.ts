import type { z } from 'zod';

export function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input';
}
