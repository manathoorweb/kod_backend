import { FastifyInstance } from 'fastify';
import { registerForBattle, getMyRegistrations } from '../controllers/registration.controller';
import { authenticate } from '../middleware/auth';

export async function registrationRoutes(fastify: FastifyInstance) {
  fastify.post('/', { preValidation: [authenticate] }, registerForBattle);
  fastify.get('/my', { preValidation: [authenticate] }, getMyRegistrations);
}
