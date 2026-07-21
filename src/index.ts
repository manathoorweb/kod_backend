import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Force loading of the backend .env specifically
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

import { pool, dbStorage } from './config/db.js';
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

const fastify = Fastify({
  logger: true,
});

const PORT = parseInt(process.env.PORT || '8787', 10);

async function bootstrap() {
  try {
    // Register Cookie Plugin (Required for HTTP-only refresh tokens)
    await fastify.register(cookie, {
      secret: process.env.COOKIE_SECRET || 'kod-cookie-secret-9182',
    });

    // Register CORS
    await fastify.register(cors, {
      origin: process.env.NODE_ENV === 'development'
        ? true
        : [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:4028',
          'http://127.0.0.1:3000',
          'https://apiback.kodindia.com'
        ],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    });

    // Database request connection pool context hooks
    fastify.addHook('preHandler', (request, reply, done) => {
      pool.connect().then((client) => {
        (request as any).dbClient = client;
        dbStorage.run(client, () => {
          done();
        });
      }).catch(done);
    });

    fastify.addHook('onResponse', (request, reply, done) => {
      const client = (request as any).dbClient;
      if (client && typeof client.release === 'function') {
        client.release();
      }
      done();
    });

    // Healthcheck endpoint
    fastify.get('/health', async (request, reply) => {
      // Test DB connection
      const dbTest = await pool.query('SELECT NOW()');
      return {
        status: 'OK',
        timestamp: new Date(),
        database: dbTest.rows.length > 0 ? 'connected' : 'disconnected',
      };
    });

    // Register Routes
    await fastify.register(authRoutes, { prefix: '/api/auth' });
    await fastify.register(battleRoutes, { prefix: '/api/battles' });
    await fastify.register(registrationRoutes, { prefix: '/api/registrations' });
    await fastify.register(dashboardRoutes, { prefix: '/api/dashboard' });
    await fastify.register(blogRoutes, { prefix: '/api/blog' });
    await fastify.register(reviewRoutes, { prefix: '/api/client' });
    await fastify.register(programRoutes, { prefix: '/api/programs' });
    await fastify.register(incompleteOrdersRoutes, { prefix: '/api/incomplete-orders' });
    await fastify.register(checkoutRoutes, { prefix: '/api/payment' });
    await fastify.register(checkoutRoutes, { prefix: '/api/checkout' });

    // Graceful Shutdown hooks
    fastify.addHook('onClose', async (instance) => {
      fastify.log.info('Stopping database background worker...');
      stopWorker();
      fastify.log.info('Closing database pool connection...');
      await pool.end();
    });

    // Start background database worker
    startWorker();

    await fastify.listen({ port: PORT, host: '0.0.0.0' });
    fastify.log.info(`Fastify server successfully listening on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

bootstrap();
// trigger restart
