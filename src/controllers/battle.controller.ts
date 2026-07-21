import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

interface ListBattlesQuery {
  category?: string;
  status?: string;
  hostId?: string;
}

interface BattleParams {
  id: string;
}

/**
 * Controller handling public battles (events) retrieval
 */
export async function listBattles(request: FastifyRequest, reply: FastifyReply) {
  const { category, status, hostId } = request.query as ListBattlesQuery;
  
  try {
    let queryText = `
      SELECT battles.*, programs.image_url AS program_image_url 
      FROM battles 
      LEFT JOIN programs ON battles.program_id = programs.id
    `;
    const queryParams: any[] = [];
    const conditions: string[] = [];

    if (category) {
      queryParams.push(category);
      conditions.push(`battles.category = $${queryParams.length}`);
    }

    if (status) {
      queryParams.push(status);
      conditions.push(`battles.status = $${queryParams.length}::battle_status`);
    }

    if (hostId) {
      queryParams.push(hostId);
      conditions.push(`battles.host_id = $${queryParams.length}`);
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ' ORDER BY battles.battle_date DESC';

    const battlesRes = await pool.query(queryText, queryParams);
    const rows = battlesRes.rows.map((row) => {
      if (!row.image_url && row.program_image_url) {
        row.image_url = row.program_image_url;
      }
      return row;
    });
    return reply.send(rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve battles list' });
  }
}

export async function getBattleById(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as BattleParams;

  try {
    const battleRes = await pool.query(
      `SELECT battles.*, programs.image_url AS program_image_url 
       FROM battles 
       LEFT JOIN programs ON battles.program_id = programs.id 
       WHERE battles.id = $1`,
      [id]
    );
    if (battleRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Battle event not found' });
    }
    const battle = battleRes.rows[0];
    if (!battle.image_url && battle.program_image_url) {
      battle.image_url = battle.program_image_url;
    }
    return reply.send(battle);
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
