import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authPlugin from './plugins/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { recipeRoutes } from './routes/recipes';
import { importRoutes } from './routes/imports';
import { closeSharedBrowser } from './lib/instagramScraper';

export function buildApp() {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'] });
  app.register(multipart, {
    attachFieldsToBody: true,
    limits: { fileSize: 10 * 1024 * 1024 },
  });
  app.register(authPlugin);
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(recipeRoutes);
  app.register(importRoutes);
  // Instagram scraping keeps a shared Chromium instance warm across imports
  // (see instagramScraper.ts) — close it when the server shuts down so it
  // doesn't outlive the process (dev restarts via `tsx watch` included).
  app.addHook('onClose', closeSharedBrowser);
  return app;
}
