import { FastifyInstance } from 'fastify';
import { 
  registerForBattle, 
  getMyRegistrations, 
  getDancerProfile, 
  getAllDancerProfiles, 
  updateDancerProfile, 
  registerForProgram 
} from '../controllers/registration.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';

export async function registrationRoutes(fastify: FastifyInstance) {
  fastify.post('/', { preValidation: [authenticate] }, registerForBattle);
  fastify.get('/my', { preValidation: [authenticate] }, getMyRegistrations);
  fastify.get('/dancer-profile/:userId', getDancerProfile);
  fastify.get('/dancer-profiles', getAllDancerProfiles);
  fastify.put('/dancer-profile/:userId', { preValidation: [authenticate] }, updateDancerProfile);
  fastify.post('/program', { preValidation: [authenticate] }, registerForProgram);
}
