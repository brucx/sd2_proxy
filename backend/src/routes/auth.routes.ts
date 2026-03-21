import { Hono } from 'hono';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { authMiddleware } from '../middlewares/auth.middleware.js';
import { loginAttempts, LOGIN_MAX_ATTEMPTS } from '../middlewares/proxy.middleware.js';
import type { AppVariables } from '../types.js';

export const authRoutes = new Hono<{ Variables: AppVariables }>();

// Login
authRoutes.post('/login', async (c) => {
  const loginIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  const now = Date.now();
  let attempt = loginAttempts[loginIp];
  if (!attempt || attempt.resetTime < now) {
    attempt = { count: 0, resetTime: now + 60000 };
    loginAttempts[loginIp] = attempt;
  }
  if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
    return c.json({ error: '登录尝试过于频繁，请稍后再试' }, 429);
  }
  attempt.count++;

  const { username, password } = await c.req.json();

  if (!username || !password) return c.json({ error: 'Invalid credentials' }, 401);

  const user = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);

  if (!user || user.length === 0 || !user[0]) return c.json({ error: 'Invalid credentials' }, 401);

  const match = await bcrypt.compare(password, user[0].passwordHash);
  if (!match) return c.json({ error: 'Invalid credentials' }, 401);

  const token = jwt.sign({ id: user[0].id, role: user[0].role }, config.JWT_SECRET, { expiresIn: '24h' });
  return c.json({ token, role: user[0].role, username: user[0].username });
});

// Get current user info
authRoutes.get('/me', authMiddleware, async (c) => {
  const user = c.get('user');
  const userInfo = await db.select({ id: schema.users.id, username: schema.users.username, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  return c.json(userInfo[0]);
});

// Change own password
authRoutes.put('/me/password', authMiddleware, async (c) => {
  const user = c.get('user');
  const { oldPassword, newPassword } = await c.req.json();

  if (!oldPassword || !newPassword) return c.json({ error: 'Old password and new password are required' }, 400);
  if (typeof newPassword !== 'string' || newPassword.length < 6) return c.json({ error: '密码长度不能少于 6 位' }, 400);

  const dbUser = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (dbUser.length === 0) return c.json({ error: 'User not found' }, 404);

  const match = await bcrypt.compare(oldPassword, dbUser[0]!.passwordHash);
  if (!match) return c.json({ error: 'Old password is incorrect' }, 400);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));
  return c.json({ success: true });
});
