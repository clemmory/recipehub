import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get('/health/db', async (req, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'connected' };
    } catch (err) {
      req.log.error({ err }, '[health] DB connectivity check failed');
      reply.code(503);
      return { status: 'error', db: 'unreachable' };
    }
  });
}
