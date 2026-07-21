import { FastifyInstance } from 'fastify';
import { createProgram, listPrograms, getProgramById, listFormats, createFormat, deleteProgram, updateProgram } from '../controllers/program.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

export async function programRoutes(fastify: FastifyInstance) {
  fastify.get('/', listPrograms);
  fastify.get('/formats', listFormats);
  fastify.get('/:id', getProgramById);
  fastify.post('/', { preValidation: [authenticate] }, createProgram);
  fastify.put('/:id', { preValidation: [authenticate] }, updateProgram);
  fastify.post('/formats', { preValidation: [authenticate] }, createFormat);
  fastify.delete('/:id', { preValidation: [authenticate] }, deleteProgram);
}
