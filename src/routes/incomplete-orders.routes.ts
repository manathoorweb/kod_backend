import { Hono } from 'hono';
import {
  saveIncompleteOrder,
  getIncompleteOrder,
  deleteIncompleteOrder,
  getIncompleteOrdersList,
  getIncompleteOrdersByUser
} from '../controllers/incomplete-orders.controller.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

app.post('/', wrap(saveIncompleteOrder));
app.get('/', wrap(getIncompleteOrdersList));
app.get('/user/:userId', wrap(getIncompleteOrdersByUser));
app.get('/:id', wrap(getIncompleteOrder));
app.delete('/:id', wrap(deleteIncompleteOrder));

export { app as incompleteOrdersRoutes };
