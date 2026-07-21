import { Hono } from 'hono';
import { register, login, firebaseLogin, refresh, logout, getMe, updatePhoneNumber } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

app.post('/register', wrap(register));
app.post('/login', wrap(login));
app.post('/firebase', wrap(firebaseLogin));
app.post('/refresh', wrap(refresh));
app.post('/logout', wrap(logout));
app.get('/me', wrap(authenticate), wrap(getMe));
app.post('/phone', wrap(authenticate), wrap(updatePhoneNumber));

export { app as authRoutes };
