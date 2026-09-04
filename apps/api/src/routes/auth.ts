import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { firstZodMessage } from '../lib/validation';

const emailSchema = z.string().email('Please enter a valid email address');

const registerSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Please enter your password'),
});

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstZodMessage(parsed.error) });
    }
    const { email, password } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return reply.code(409).send({ error: 'An account with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { email, passwordHash } });

    const token = app.jwt.sign({ userId: user.id }, { expiresIn: '30d' });
    return reply.code(201).send({ token, user: { id: user.id, email: user.email } });
  });

  app.post('/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: firstZodMessage(parsed.error) });
    }
    const { email, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.code(401).send({ error: 'No account found with this email' });
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Incorrect password' });
    }

    const token = app.jwt.sign({ userId: user.id }, { expiresIn: '30d' });
    return reply.send({ token, user: { id: user.id, email: user.email } });
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user.userId } });
    return { id: user.id, email: user.email };
  });
}
