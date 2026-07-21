import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

export async function saveIncompleteOrder(request: FastifyRequest, reply: FastifyReply) {
  const { id, type, programId, userData, userId } = request.body as {
    id?: string;
    type: string;
    programId: string;
    userData: any;
    userId?: string;
  };

  try {
    const orderId = userData?.orderId;
    if (id || orderId) {
      const matchId = id || orderId;
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const isUuid = uuidRegex.test(matchId);

      // Try to update existing by UUID or by user_data->>'orderId'
      const updateQuery = isUuid
        ? `UPDATE incomplete_orders 
           SET user_data = $1, user_id = $2, updated_at = NOW() 
           WHERE id = $3 
           RETURNING id`
        : `UPDATE incomplete_orders 
           SET user_data = $1, user_id = $2, updated_at = NOW() 
           WHERE user_data->>'orderId' = $3 
           RETURNING id`;

      const updateRes = await pool.query(updateQuery, [JSON.stringify(userData), userId || null, matchId]);
      if (updateRes.rows.length > 0) {
        return reply.send({ success: true, id: updateRes.rows[0].id });
      }
    }

    // Insert new
    const insertRes = await pool.query(
      `INSERT INTO incomplete_orders (type, program_id, user_data, user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [type, programId, JSON.stringify(userData), userId || null]
    );
    return reply.send({ success: true, id: insertRes.rows[0].id });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to save incomplete order' });
  }
}

export async function getIncompleteOrder(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isUuid = uuidRegex.test(id);

  try {
    const selectQuery = isUuid
      ? `SELECT io.*, p.title as program_title 
         FROM incomplete_orders io
         LEFT JOIN programs p ON io.program_id = p.id
         WHERE io.id = $1`
      : `SELECT io.*, p.title as program_title 
         FROM incomplete_orders io
         LEFT JOIN programs p ON io.program_id = p.id
         WHERE io.user_data->>'orderId' = $1
         ORDER BY io.updated_at DESC
         LIMIT 1`;

    const result = await pool.query(selectQuery, [id]);
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Order draft not found' });
    }
    return reply.send({ success: true, data: result.rows[0] });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve order draft' });
  }
}

export async function deleteIncompleteOrder(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isUuid = uuidRegex.test(id);

  try {
    const deleteQuery = isUuid
      ? 'DELETE FROM incomplete_orders WHERE id = $1'
      : "DELETE FROM incomplete_orders WHERE user_data->>'orderId' = $1";

    await pool.query(deleteQuery, [id]);
    return reply.send({ success: true });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to delete order draft' });
  }
}

export async function getIncompleteOrdersList(request: FastifyRequest, reply: FastifyReply) {
  try {
    const result = await pool.query(`SELECT * FROM incomplete_orders ORDER BY updated_at DESC`);
    return reply.send({ success: true, data: result.rows });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to list drafts' });
  }
}

export async function getIncompleteOrdersByUser(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.params as { userId: string };
  try {
    const result = await pool.query(
      `SELECT io.*, p.title as program_title 
       FROM incomplete_orders io
       LEFT JOIN programs p ON io.program_id = p.id
       WHERE io.user_id = $1
       ORDER BY io.updated_at DESC`,
      [userId]
    );
    return reply.send({ success: true, data: result.rows });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve user drafts' });
  }
}
