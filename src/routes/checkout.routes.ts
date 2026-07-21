import { FastifyInstance } from 'fastify';
import { initiateCheckout, confirmCheckoutMock, verifyCheckoutQR, signTransition, verifyTransition } from '../controllers/checkout.controller.js';
import { validateInitiateCheckout, validateConfirmCheckout } from '../middleware/checkout.middleware.js';

export async function checkoutRoutes(fastify: FastifyInstance) {
  fastify.post('/initiate', { preValidation: [validateInitiateCheckout] }, initiateCheckout);
  fastify.post('/mock-success', { preValidation: [validateConfirmCheckout] }, confirmCheckoutMock);
  fastify.get('/verify-qr', verifyCheckoutQR);
  fastify.post('/sign-transition', signTransition);
  fastify.post('/verify-transition', verifyTransition);
}
