import { Hono } from 'hono';
import {
  getClientSettings,
  updateClientSettings,
  getClientReviews,
  createClientReview,
} from '../controllers/review.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

app.get('/settings', wrap(getClientSettings));
app.put('/settings', wrap(authenticate), wrap(updateClientSettings));
app.get('/reviews', wrap(getClientReviews));
app.post('/reviews', wrap(createClientReview));

export { app as reviewRoutes };
