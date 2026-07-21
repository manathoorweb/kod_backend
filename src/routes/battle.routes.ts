import { Hono } from 'hono';
import { listBattles, getBattleById, getBattleCalendar } from '../controllers/battle.controller.js';
import { wrap } from '../utils/hono-adapter.js';

const app = new Hono();

app.get('/', wrap(listBattles));
app.get('/calendar', wrap(getBattleCalendar));
app.get('/:id', wrap(getBattleById));

export { app as battleRoutes };
