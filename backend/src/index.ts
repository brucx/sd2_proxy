import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { logger as honoLogger } from 'hono/logger';
import { cors } from 'hono/cors';
import bcrypt from 'bcrypt';
import { db } from './db/index.js';
import * as schema from './db/schema.js';
import { eq } from 'drizzle-orm';

import { config } from './config.js';
import type { AppVariables } from './types.js';
import { logger } from './utils/logger.util.js';
import { startCleanupInterval } from './middlewares/proxy.middleware.js';
import { loadConcurrencyCache } from './services/concurrency.service.js';
import { startCronJobs } from './services/cron.service.js';

// Routes
import { authRoutes } from './routes/auth.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { tenantRoutes } from './routes/tenant.routes.js';
import { proxyRoutes } from './routes/proxy.routes.js';

const app = new Hono<{ Variables: AppVariables }>();

app.use('*', honoLogger());
app.use('*', cors({
  origin: config.CORS_ORIGINS as any,
}));

// Security response headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Disable caching for all API responses
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.header('Pragma', 'no-cache');
});

// Health check endpoints
app.get('/health', (c) => c.text('OK'));
app.get('/api/health', (c) => c.text('OK'));

// Mount Routes
app.route('/api/panel', authRoutes);
app.route('/api/panel/admin', adminRoutes);
app.route('/api/panel', tenantRoutes); 
app.route('/api/v1/doubao', proxyRoutes);

// Setup Initial Admin (Run once)
const setupInitialAdmin = async () => {
  try {
    const admin = await db.select().from(schema.users).where(eq(schema.users.username, 'admin')).limit(1);
    if (admin.length === 0) {
      const adminPwd = config.ADMIN_DEFAULT_PASSWORD;
      const passwordHash = await bcrypt.hash(adminPwd, 10);
      await db.insert(schema.users).values({ username: 'admin', passwordHash, role: 'admin' });
      logger.info('Initial admin created');
    }
  } catch (e) {
    logger.error({ err: e }, 'Error setting up initial admin');
  }
}

// Initialization
startCleanupInterval();
startCronJobs();
setupInitialAdmin().then(() => loadConcurrencyCache());

// Serve Frontend Static Files
app.use('/*', serveStatic({ root: '../frontend/dist' }));

// For client-side routing, handle fallback
app.get('*', serveStatic({ path: '../frontend/dist/index.html' }));

const port = 3000;
logger.info(`Server is running on port ${port}`);

serve({
  fetch: app.fetch,
  port
});
