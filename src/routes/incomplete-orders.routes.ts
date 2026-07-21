import { FastifyInstance } from 'fastify';
import {
  saveIncompleteOrder,
  getIncompleteOrder,
  deleteIncompleteOrder,
  getIncompleteOrdersList,
  getIncompleteOrdersByUser
} from '../controllers/incomplete-orders.controller.js';

export async function incompleteOrdersRoutes(fastify: FastifyInstance) {
  fastify.post('/', saveIncompleteOrder);
  fastify.get('/', getIncompleteOrdersList);
  fastify.get('/user/:userId', getIncompleteOrdersByUser);
  fastify.get('/:id', getIncompleteOrder);
  fastify.delete('/:id', deleteIncompleteOrder);
}
