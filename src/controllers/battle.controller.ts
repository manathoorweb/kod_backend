import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

interface ListBattlesQuery {
  category?: string;
  status?: string;
}

interface BattleParams {
  id: string;
}

/**
 * Controller handling public battles (events) retrieval
 */
export async function listBattles(request: FastifyRequest, reply: FastifyReply) {
  const { category, status } = request.query as ListBattlesQuery;
  
  try {
    let queryText = 'SELECT * FROM battles';
    const queryParams: any[] = [];
    const conditions: string[] = [];

    if (category) {
      queryParams.push(category);
      conditions.push(`category = $${queryParams.length}`);
    }

    if (status) {
      queryParams.push(status);
      conditions.push(`status = $${queryParams.length}::battle_status`);
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ' ORDER BY battle_date DESC';

    const battlesRes = await pool.query(queryText, queryParams);
    return reply.send(battlesRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve battles list' });
  }
}

export async function getBattleById(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as BattleParams;

  try {
    const battleRes = await pool.query('SELECT * FROM battles WHERE id = $1', [id]);
    if (battleRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Battle event not found' });
    }
    return reply.send(battleRes.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve battle details' });
  }
}

export async function getBattleCalendar(request: FastifyRequest, reply: FastifyReply) {
  try {
    const calendarRes = await pool.query(
      `SELECT id, title, category, battle_date, battle_time, location, country, status 
       FROM battles 
       WHERE battle_date >= CURRENT_DATE 
       ORDER BY battle_date ASC`
    );
    return reply.send(calendarRes.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve battle calendar schedule' });
  }
}
