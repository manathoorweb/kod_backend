import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

export async function getClientSettings(request: FastifyRequest, reply: FastifyReply) {
  try {
    const result = await pool.query('SELECT * FROM client_settings LIMIT 1');
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Client settings not found' });
    }
    return reply.send(result.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

export async function updateClientSettings(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { business_name, logo_url } = request.body as { business_name?: string; logo_url?: string };
    
    const result = await pool.query(
      `INSERT INTO client_settings (id, business_name, logo_url, updated_at) 
       VALUES ('default', $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE 
       SET business_name = EXCLUDED.business_name, 
           logo_url = EXCLUDED.logo_url, 
           updated_at = NOW()
       RETURNING *`,
      [business_name || 'Tech Wise Foundation', logo_url || '']
    );
    
    return reply.send(result.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

export async function getClientReviews(request: FastifyRequest, reply: FastifyReply) {
  try {
    const result = await pool.query('SELECT * FROM client_reviews ORDER BY created_at DESC');
    return reply.send(result.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}

export async function createClientReview(request: FastifyRequest, reply: FastifyReply) {
  try {
    const { author_name, rating, comment, photos } = request.body as {
      author_name: string;
      rating: number;
      comment: string;
      photos?: string[];
    };
    
    if (!author_name || rating === undefined) {
      return reply.status(400).send({ error: 'Author name and rating are required' });
    }
    
    const result = await pool.query(
      `INSERT INTO client_reviews (author_name, rating, comment, photos, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING *`,
      [author_name, rating, comment || '', photos || []]
    );
    
    return reply.status(201).send(result.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error' });
  }
}
