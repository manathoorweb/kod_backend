import { Hono } from 'hono';
import { createProgram, listPrograms, getProgramById, listFormats, createFormat, deleteProgram, updateProgram } from '../controllers/program.controller.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

app.get('/', wrap(listPrograms));
app.get('/formats', wrap(listFormats));
app.get('/:id', wrap(getProgramById));
app.post('/', wrap(authenticate), wrap(createProgram));
app.put('/:id', wrap(authenticate), wrap(updateProgram));
app.post('/formats', wrap(authenticate), wrap(createFormat));
app.delete('/:id', wrap(authenticate), wrap(deleteProgram));

export { app as programRoutes };
