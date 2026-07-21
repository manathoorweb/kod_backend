import { Hono } from 'hono';
import {
  createBattle,
  updateBattle,
  deleteBattle,
  listRegistrationsForBattle,
  updateRegistrationStatus,
} from '../controllers/dashboard.controller.js';
import { saveToken, sendAdminPushNotification } from '../controllers/notification.controller.js';
import { authenticate, requireRoles } from '../middleware/auth.middleware.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

// Battle management
app.post('/battles', wrap(authenticate), wrap(requireRoles(['admin', 'organizer'])), wrap(createBattle));
app.put('/battles/:id', wrap(authenticate), wrap(requireRoles(['admin', 'organizer'])), wrap(updateBattle));
app.delete('/battles/:id', wrap(authenticate), wrap(requireRoles(['admin', 'organizer'])), wrap(deleteBattle));

// Registration audits
app.get('/battles/:id/registrations', wrap(authenticate), wrap(requireRoles(['admin', 'organizer'])), wrap(listRegistrationsForBattle));
app.put('/registrations/:id/status', wrap(authenticate), wrap(requireRoles(['admin', 'organizer'])), wrap(updateRegistrationStatus));

// Push notifications management
app.post('/notifications/save-token', wrap(authenticate), wrap(saveToken));
app.post('/notifications/send', wrap(authenticate), wrap(requireRoles(['admin'])), wrap(sendAdminPushNotification));

export { app as dashboardRoutes };
