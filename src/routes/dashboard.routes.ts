import { FastifyInstance } from 'fastify';
import {
  createBattle,
  updateBattle,
  deleteBattle,
  listRegistrationsForBattle,
  updateRegistrationStatus,
} from '../controllers/dashboard.controller';
import { saveToken, sendAdminPushNotification } from '../controllers/notification.controller';
import { authenticate, requireRoles } from '../middleware/auth';

export async function dashboardRoutes(fastify: FastifyInstance) {
  const isAuthorizedHost = [authenticate, requireRoles(['admin', 'organizer'])];
  const isAuthorizedAdmin = [authenticate, requireRoles(['admin'])];

  // Battle management
  fastify.post('/battles', { preValidation: isAuthorizedHost }, createBattle);
  fastify.put('/battles/:id', { preValidation: isAuthorizedHost }, updateBattle);
  fastify.delete('/battles/:id', { preValidation: isAuthorizedHost }, deleteBattle);

  // Registration audits
  fastify.get('/battles/:id/registrations', { preValidation: isAuthorizedHost }, listRegistrationsForBattle);
  fastify.put('/registrations/:id/status', { preValidation: isAuthorizedHost }, updateRegistrationStatus);

  // Push notifications management
  fastify.post('/notifications/save-token', { preValidation: [authenticate] }, saveToken);
  fastify.post('/notifications/send', { preValidation: isAuthorizedAdmin }, sendAdminPushNotification);
}
