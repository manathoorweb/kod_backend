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

import { pool } from './config/db';
import { authRoutes } from './routes/auth.routes';
import { battleRoutes } from './routes/battle.routes';
import { registrationRoutes } from './routes/registration.routes';
import { dashboardRoutes } from './routes/dashboard.routes';
import { startWorker, stopWorker } from './services/worker.service';

const fastify = Fastify({
  logger: true,
});

const PORT = parseInt(process.env.PORT || '4029', 10);

async function bootstrap() {
  try {
    // Register Cookie Plugin (Required for HTTP-only refresh tokens)
    await fastify.register(cookie, {
      secret: process.env.COOKIE_SECRET || 'kod-cookie-secret-9182',
    });

    // Register CORS
    await fastify.register(cors, {
      origin: (origin, cb) => {
        if (!origin) {
          cb(null, true);
          return;
        }
        try {
          const url = new URL(origin);
          if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
            cb(null, true);
            return;
          }
        } catch (e) {
          // Ignore invalid URL formats
        }
        cb(new Error('Not allowed by CORS'), false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
