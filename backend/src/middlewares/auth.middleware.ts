import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { Context, Next } from 'hono';
import type { AppVariables } from '../types.js';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const authMiddleware = async (c: Context<{ Variables: AppVariables }>, next: Next) => {
  const token = c.req.header('Authorization')?.split(' ')[1];
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as any;
    const dbUser = await db.select().from(schema.users).where(eq(schema.users.id, payload.id)).limit(1);
    if (!dbUser[0] || dbUser[0].status !== 'active') {
      return c.json({ error: 'Account suspended' }, 403);
    }
    c.set('user', payload);
    await next();
  } catch (err) {
    return c.json({ error: 'Invalid token' }, 401);
  }
};

export const adminMiddleware = async (c: Context<{ Variables: AppVariables }>, next: Next) => {
  const user = c.get('user');
  if (user?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  await next();
};
