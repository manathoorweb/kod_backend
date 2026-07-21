import { Hono } from 'hono';
import { 
  registerForBattle, 
  getMyRegistrations, 
  getDancerProfile, 
  getAllDancerProfiles, 
  updateDancerProfile, 
  registerForProgram 
} from '../controllers/registration.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

app.post('/', wrap(authenticate), wrap(registerForBattle));
app.get('/my', wrap(authenticate), wrap(getMyRegistrations));
app.get('/dancer-profile/:userId', wrap(getDancerProfile));
app.get('/dancer-profiles', wrap(getAllDancerProfiles));
app.put('/dancer-profile/:userId', wrap(authenticate), wrap(updateDancerProfile));
app.post('/program', wrap(authenticate), wrap(registerForProgram));

export { app as registrationRoutes };
