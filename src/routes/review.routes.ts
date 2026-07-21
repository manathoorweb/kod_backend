import { FastifyInstance } from 'fastify';
import {
  getClientSettings,
  updateClientSettings,
  getClientReviews,
  createClientReview,
} from '../controllers/review.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

export async function reviewRoutes(fastify: FastifyInstance) {
  fastify.get('/settings', getClientSettings);
  fastify.put('/settings', { preValidation: [authenticate] }, updateClientSettings);
  fastify.get('/reviews', getClientReviews);
  fastify.post('/reviews', createClientReview);
}
