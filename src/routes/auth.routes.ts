import { FastifyInstance } from 'fastify';
import { register, login, firebaseLogin, refresh, logout, getMe, updatePhoneNumber } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', register);
  fastify.post('/login', login);
  fastify.post('/firebase', firebaseLogin);
  fastify.post('/refresh', refresh);
  fastify.post('/logout', logout);
  fastify.get('/me', { preValidation: [authenticate] }, getMe);
  fastify.post('/phone', { preValidation: [authenticate] }, updatePhoneNumber);
}
