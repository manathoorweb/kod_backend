import { FastifyInstance } from 'fastify';
import { register, login, firebaseLogin, refresh, logout, getMe } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', register);
  fastify.post('/login', login);
  fastify.post('/firebase', firebaseLogin);
  fastify.post('/refresh', refresh);
  fastify.post('/logout', logout);
  fastify.get('/me', { preValidation: [authenticate] }, getMe);
}
