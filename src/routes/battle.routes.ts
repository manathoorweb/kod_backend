import { FastifyInstance } from 'fastify';
import { listBattles, getBattleById, getBattleCalendar } from '../controllers/battle.controller';

export async function battleRoutes(fastify: FastifyInstance) {
  fastify.get('/', listBattles);
  fastify.get('/calendar', getBattleCalendar);
  fastify.get('/:id', getBattleById);
}
