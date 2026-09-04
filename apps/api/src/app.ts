import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authPlugin from './plugins/auth';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { recipeRoutes } from './routes/recipes';

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
  return app;
}
