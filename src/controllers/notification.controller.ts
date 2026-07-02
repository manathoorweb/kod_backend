import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

interface SaveTokenBody {
  token: string;
  deviceType?: string;
}

interface SendNotificationBody {
  title: string;
  body: string;
  targetUserIds?: string[];
  targetRole?: string;
}

/**
 * Controller handling FCM device tokens and system push notifications
 */
export async function saveToken(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const { token, deviceType } = request.body as SaveTokenBody;

  if (!token) {
    return reply.status(400).send({ error: 'FCM token is required' });
  }

  try {
    await pool.query(
      `INSERT INTO user_fcm_tokens (user_id, token, device_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, token) DO UPDATE 
       SET device_type = EXCLUDED.device_type, updated_at = CURRENT_TIMESTAMP`,
      [user.userId, token, deviceType || 'web']
    );

    return reply.send({ message: 'FCM token registered successfully' });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to save FCM token' });
  }
}

export async function sendAdminPushNotification(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const user = request.user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const { title, body, targetUserIds, targetRole } = request.body as SendNotificationBody;

  if (!title || !body) {
    return reply.status(400).send({ error: 'Required fields: title, body' });
  }

  try {
    let tokensQuery = 'SELECT token FROM user_fcm_tokens';
    const queryParams: any[] = [];

    if (targetUserIds && targetUserIds.length > 0) {
      queryParams.push(targetUserIds);
      tokensQuery += ` WHERE user_id = ANY($1)`;
    } else if (targetRole) {
      queryParams.push(targetRole);
      tokensQuery += ` JOIN user_profiles up ON user_fcm_tokens.user_id = up.id 
                       WHERE $1 = ANY(up.roles)`;
    }

    const tokensRes = await pool.query(tokensQuery, queryParams);
    const tokens = tokensRes.rows.map((row) => row.token);

    if (tokens.length === 0) {
      return reply.status(404).send({ error: 'No active device tokens found for target audience' });
    }

    // Insert job into database queue for asynchronous background processing
    const jobRes = await pool.query(
      `INSERT INTO job_queue (job_type, payload)
       VALUES ($1, $2)
       RETURNING id`,
      ['send_bulk_notification', JSON.stringify({ title, body, tokens })]
    );

    return reply.status(202).send({
      message: 'System push notification job successfully queued',
      jobId: jobRes.rows[0].id,
      recipientsCount: tokens.length
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to queue notification job' });
  }
}
