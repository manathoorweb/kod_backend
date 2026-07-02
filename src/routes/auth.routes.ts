import { FastifyInstance } from 'fastify';
import { register, login, firebaseLogin, refresh, logout } from '../controllers/auth.controller';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', register);
  fastify.post('/login', login);
  fastify.post('/firebase', firebaseLogin);
  fastify.post('/refresh', refresh);
  fastify.post('/logout', logout);
}
