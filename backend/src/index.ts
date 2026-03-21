import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { config } from 'dotenv';
import { db } from './db/index.js';
import * as schema from './db/schema.js';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';

config();

const app = new Hono<{
  Variables: {
    user: any;
    keyRecord: any;
  }
}>();

app.use('*', logger());
app.use('*', cors());

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://118.196.64.1';
const ARK_API_KEY = process.env.ARK_API_KEY || 'test-ark-key';

// -- Authentication Middleware for Panel --
const authMiddleware = async (c: any, next: any) => {
  const token = c.req.header('Authorization')?.split(' ')[1];
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    c.set('user', payload);
    await next();
  } catch (err) {
    return c.json({ error: 'Invalid token' }, 401);
  }
};

const adminMiddleware = async (c: any, next: any) => {
  const user = c.get('user') as any;
  if (user.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  await next();
};

// -- Panel API --

// Login
app.post('/api/panel/login', async (c) => {
  const { username, password } = await c.req.json();
  const user = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);

  if (!user || user.length === 0 || !user[0]) return c.json({ error: 'Invalid credentials' }, 401);

  const match = await bcrypt.compare(password, user[0].passwordHash);
  if (!match) return c.json({ error: 'Invalid credentials' }, 401);

  const token = jwt.sign({ id: user[0].id, role: user[0].role }, JWT_SECRET, { expiresIn: '24h' });
  return c.json({ token, role: user[0].role });
});

// Get current user info
app.get('/api/panel/me', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const userInfo = await db.select({ id: schema.users.id, username: schema.users.username, role: schema.users.role }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  return c.json(userInfo[0]);
});

// Change own password
app.put('/api/panel/me/password', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const { oldPassword, newPassword } = await c.req.json();

  if (!oldPassword || !newPassword) return c.json({ error: 'Old password and new password are required' }, 400);

  const dbUser = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (dbUser.length === 0) return c.json({ error: 'User not found' }, 404);

  const match = await bcrypt.compare(oldPassword, dbUser[0]!.passwordHash);
  if (!match) return c.json({ error: 'Old password is incorrect' }, 400);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, user.id));
  return c.json({ success: true });
});

// Admin: Reset user password
app.put('/api/panel/admin/users/:id/password', authMiddleware, adminMiddleware, async (c) => {
  const userId = parseInt(c.req.param('id'));
  const { newPassword } = await c.req.json();

  if (!newPassword) return c.json({ error: 'New password is required' }, 400);

  const targetUser = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (targetUser.length === 0) return c.json({ error: 'User not found' }, 404);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  return c.json({ success: true });
});

// Admin: Get all users
app.get('/api/panel/admin/users', authMiddleware, adminMiddleware, async (c) => {
  const usersList = await db.select({ id: schema.users.id, username: schema.users.username, role: schema.users.role, createdAt: schema.users.createdAt }).from(schema.users);
  return c.json(usersList);
});

// Admin: Create user
app.post('/api/panel/admin/users', authMiddleware, adminMiddleware, async (c) => {
  const { username, password, role } = await c.req.json();
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await db.insert(schema.users).values({ username, passwordHash, role: role || 'tenant' });
    return c.json({ success: true });
  } catch (e: any) {
    return c.json({ error: 'Username may already exist' }, 400);
  }
});

// Tenant: Get keys
app.get('/api/panel/keys', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const userKeys = await db.select().from(schema.keys).where(eq(schema.keys.userId, user.id));
  return c.json(userKeys);
});

// Tenant: Create key
app.post('/api/panel/keys', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const { name } = await c.req.json();
  const { v4: uuidv4 } = await import('uuid');
  const apiKey = `sk-${uuidv4().replace(/-/g, '')}`;

  await db.insert(schema.keys).values({ userId: user.id, apiKey, name });
  return c.json({ success: true, apiKey });
});

// Tenant: Get Usage
app.get('/api/panel/usage', authMiddleware, async (c) => {
  const user = c.get('user') as any;
  const logs = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.userId, user.id));
  return c.json(logs);
});

// Admin: Get All Usage
app.get('/api/panel/admin/usage', authMiddleware, adminMiddleware, async (c) => {
  const logs = await db.select().from(schema.usageLogs);
  return c.json(logs);
});

// -- API Proxy Middleware & Handlers --

// Simple In-memory Rate Limiting (Requests per minute per key)
const rateLimits: Record<string, { count: number, resetTime: number }> = {};
const RATE_LIMIT_MAX = 60; // 60 requests per minute

const proxyAuthMiddleware = async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401);
  }

  const apiKey = authHeader.split(' ')[1];
  const keyRecord = await db.select().from(schema.keys).where(eq(schema.keys.apiKey, apiKey)).limit(1);

  if (keyRecord.length === 0) {
    return c.json({ error: 'Invalid API Key' }, 401);
  }

  const now = Date.now();
  let limit = rateLimits[apiKey];
  if (!limit || limit.resetTime < now) {
    limit = { count: 0, resetTime: now + 60000 };
    rateLimits[apiKey] = limit;
  }

  if (limit.count >= RATE_LIMIT_MAX) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  limit.count++;
  c.set('keyRecord', keyRecord[0]);
  await next();
};

app.post('/api/v1/doubao/create', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord') as any;
  const body = await c.req.json();

  try {
    const upstreamRes = await fetch(`${UPSTREAM_URL}/api/v1/doubao/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data: any = await upstreamRes.json();

    if (upstreamRes.ok && data.id) {
      await db.insert(schema.usageLogs).values({
        userId: keyRecord.userId,
        keyId: keyRecord.id,
        endpoint: '/create',
        taskId: data.id,
        status: 'pending'
      });
    }

    c.status(upstreamRes.status as any);
    return c.json(data);
  } catch (error) {
    console.error('Proxy Create Error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

app.post('/api/v1/doubao/get_result', proxyAuthMiddleware, async (c) => {
  const keyRecord = c.get('keyRecord') as any;
  const body = await c.req.json();

  try {
    const upstreamRes = await fetch(`${UPSTREAM_URL}/api/v1/doubao/get_result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify(body)
    });

    const data: any = await upstreamRes.json();

    if (upstreamRes.ok && data.status) {
      // Update usage log if status changed to succeeded or failed
      if (data.status === 'succeeded' || data.status === 'failed') {
        const completionTokens = data.usage?.completion_tokens || 0;
        await db.update(schema.usageLogs)
          .set({
            status: data.status,
            completionTokens: completionTokens,
            updatedAt: new Date()
          })
          .where(eq(schema.usageLogs.taskId, data.id));
      }
    }

    c.status(upstreamRes.status as any);
    return c.json(data);
  } catch (error) {
    console.error('Proxy Get Result Error:', error);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// -- Cron Job --
// Poll pending tasks every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('Running Cron Job to poll pending tasks...');
  try {
    const pendingLogs = await db.select().from(schema.usageLogs).where(eq(schema.usageLogs.status, 'pending'));

    for (const log of pendingLogs) {
      if (!log.taskId) continue;

      const upstreamRes = await fetch(`${UPSTREAM_URL}/api/v1/doubao/get_result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ARK_API_KEY}`
        },
        body: JSON.stringify({ id: log.taskId })
      });

      if (upstreamRes.ok) {
        const data: any = await upstreamRes.json();
        if (['succeeded', 'failed', 'cancelled', 'expired'].includes(data.status)) {
          const completionTokens = data.usage?.completion_tokens || 0;
          await db.update(schema.usageLogs)
            .set({
              status: data.status,
              completionTokens: completionTokens,
              updatedAt: new Date()
            })
            .where(eq(schema.usageLogs.id, log.id));
          console.log(`Updated task ${log.taskId} status to ${data.status}`);
        }
      }
    }
  } catch (error) {
    console.error('Cron Job Error:', error);
  }
});

// Setup Initial Admin (Run once)
const setupInitialAdmin = async () => {
  try {
    const admin = await db.select().from(schema.users).where(eq(schema.users.username, 'admin')).limit(1);
    if (admin.length === 0) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await db.insert(schema.users).values({ username: 'admin', passwordHash, role: 'admin' });
      console.log('Initial admin created (admin/admin123)');
    }
  } catch (e) {
    console.error('Error setting up initial admin', e);
  }
}
setupInitialAdmin();

// Serve Frontend Static Files
app.use('/*', serveStatic({ root: '../frontend/dist' }));

// For client-side routing, handle fallback
app.get('*', serveStatic({ path: '../frontend/dist/index.html' }));

const port = 3000;
console.log(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port
});
