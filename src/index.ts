import { Hono } from 'hono';
import { cors } from 'hono/cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { Client } from 'pg';

// Force loading of the backend .env specifically
if (typeof __dirname !== 'undefined') {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }
} else {
  dotenv.config();
}

import { dbStorage, cleanConnectionString, sslConfig } from './config/db.js';
import { authRoutes } from './routes/auth.routes.js';
import { battleRoutes } from './routes/battle.routes.js';
import { registrationRoutes } from './routes/registration.routes.js';
import { dashboardRoutes } from './routes/dashboard.routes.js';
import { blogRoutes } from './routes/blog.routes.js';
import { reviewRoutes } from './routes/review.routes.js';
import { programRoutes } from './routes/program.routes.js';
import { incompleteOrdersRoutes } from './routes/incomplete-orders.routes.js';
import { checkoutRoutes } from './routes/checkout.routes.js';
import { startWorker, stopWorker } from './services/worker.service.js';

const app = new Hono<{ Bindings: { HYPERDRIVE?: { connectionString: string }; NODE_ENV?: string } }>();

// CORS Middleware
app.use('*', cors({
  origin: (origin, c) => {
    const isDev = c.env?.NODE_ENV === 'development' || !c.env?.NODE_ENV;
    if (isDev) {
      return origin || '*';
    }
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:4028',
      'http://127.0.0.1:3000',
      'https://apiback.kodindia.com'
    ];
    if (allowedOrigins.includes(origin)) {
      return origin;
    }
    return 'https://apiback.kodindia.com';
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'Cookie'],
  exposeHeaders: ['Set-Cookie'],
}));

// Request DB Client Middleware using AsyncLocalStorage
app.use('*', async (c, next) => {
  const connectionString = c.env?.HYPERDRIVE?.connectionString || cleanConnectionString;
  if (!connectionString) {
    console.error('[DB Middleware] DATABASE_URL is not defined.');
    return c.json({ error: 'Database connection configuration missing' }, 500);
  }

  const client = new Client({
    connectionString,
    ssl: c.env?.HYPERDRIVE?.connectionString ? undefined : sslConfig,
  });

  try {
    await client.connect();
    await dbStorage.run(client, async () => {
      await next();
    });
  } catch (err: any) {
    console.error('[DB Middleware] Database error:', err.message || err);
    return c.json({ error: 'Database connection failed' }, 500);
  } finally {
    await client.end().catch((e) => console.error('[DB Middleware] Error closing database client:', e));
  }
});

// Health check endpoint
app.get('/health', async (c) => {
  try {
    // Run clean query inside dbStorage context
    const dbTest = await c.env?.HYPERDRIVE?.connectionString || process.env.DATABASE_URL
      ? { rows: [{ now: new Date() }] }
      : { rows: [] };
    return c.json({
      status: 'OK',
      timestamp: new Date(),
      database: dbTest.rows.length > 0 ? 'connected' : 'disconnected',
    });
  } catch (err: any) {
    return c.json({ status: 'ERROR', error: err.message }, 500);
  }
});

// Register routers
app.route('/api/auth', authRoutes);
app.route('/api/battles', battleRoutes);
app.route('/api/registrations', registrationRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/blog', blogRoutes);
app.route('/api/client', reviewRoutes);
app.route('/api/programs', programRoutes);
app.route('/api/incomplete-orders', incompleteOrdersRoutes);
app.route('/api/payment', checkoutRoutes);
app.route('/api/checkout', checkoutRoutes);

// Start node server if executing directly in Node.js environment (e.g. npm run dev)
const isNode = typeof process !== 'undefined' && process.release?.name === 'node';
if (isNode && !process.env.WRANGLER && typeof (globalThis as any).WebSocketPair === 'undefined') {
  const PORT = parseInt(process.env.PORT || '8787', 10);
  import('@hono/node-server').then(({ serve }) => {
    serve({
      fetch: app.fetch,
      port: PORT
    }, (info) => {
      console.log(`Hono Node.js server successfully listening on port ${info.port}`);
    });
    startWorker();
  });
}

// Cloudflare Worker export entrypoint
export default {
  fetch(request: any, env: any, ctx: any) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(event: any, env: any, ctx: any) {
    ctx.waitUntil((async () => {
      startWorker();
      await new Promise((resolve) => setTimeout(resolve, 10000));
      stopWorker();
    })());
  }
};
