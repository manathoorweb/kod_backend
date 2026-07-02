import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

interface CreateBattleBody {
  title: string;
  category: string;
  battleDate: string;
  battleTime?: string;
  location: string;
  country?: string;
  maxParticipants?: number;
  prizePool?: string;
  description?: string;
  rules?: string;
  battleFormat?: string;
  registrationFee?: number;
  ticketPrice?: number;
  imageUrl?: string;
}

interface UpdateBattleBody extends Partial<CreateBattleBody> {
  status?: 'upcoming' | 'live' | 'completed' | 'cancelled' | 'pending';
}

interface BattleParams {
  id: string;
}

interface UpdateEntryStatusBody {
  entryStatus: 'pending' | 'approved' | 'rejected' | 'waitlisted';
}

interface EntryParams {
  id: string;
}

/**
 * Controller handling administrator and host management dashboards
 */
export async function createBattle(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  const {
    title,
    category,
    battleDate,
    battleTime,
    location,
    country,
    maxParticipants,
    prizePool,
    description,
    rules,
    battleFormat,
    registrationFee,
    ticketPrice,
    imageUrl
  } = request.body as CreateBattleBody;

  if (!title || !category || !battleDate || !location) {
    return reply.status(400).send({ error: 'Required fields: title, category, battleDate, location' });
  }

  try {
    const battleRes = await pool.query(
      `INSERT INTO battles (
        title, category, battle_date, battle_time, location, country, max_participants, 
        prize_pool, description, rules, battle_format, registration_fee, ticket_price, 
        image_url, created_by, host_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        title,
        category,
        battleDate,
        battleTime || '18:00',
        location,
        country || 'India',
        maxParticipants || 32,
        prizePool || null,
        description || null,
        rules || null,
        battleFormat || '1v1',
        registrationFee || 0.00,
        ticketPrice || 0.00,
        imageUrl || null,
        user.userId,
        user.userId // By default, creator is the host
      ]
    );

    return reply.status(201).send({
      message: 'Battle event created successfully',
      battle: battleRes.rows[0]
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to create battle event' });
  }
}

export async function updateBattle(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const user = request.user;
  const { id } = request.params as BattleParams;

  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  try {
    // Check ownership (only owner/admin can modify)
    const ownershipRes = await pool.query('SELECT host_id, created_by FROM battles WHERE id = $1', [id]);
    if (ownershipRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Battle not found' });
    }

    const battle = ownershipRes.rows[0];
    const isAdmin = user.roles.includes('admin');
    const isOwner = battle.host_id === user.userId || battle.created_by === user.userId;

    if (!isAdmin && !isOwner) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this battle event' });
    }

    const fields = request.body as UpdateBattleBody;
    const updateClauses: string[] = [];
    const queryParams: any[] = [];

    // Map camelCase JSON fields to snake_case DB columns
    const mappings: Record<string, string> = {
      title: 'title',
      category: 'category',
      battleDate: 'battle_date',
      battleTime: 'battle_time',
      location: 'location',
      country: 'country',
      maxParticipants: 'max_participants',
      prizePool: 'prize_pool',
      description: 'description',
      rules: 'rules',
      battleFormat: 'battle_format',
      registrationFee: 'registration_fee',
      ticketPrice: 'ticket_price',
      imageUrl: 'image_url',
      status: 'status'
    };

    Object.entries(fields).forEach(([key, val]) => {
      const dbCol = mappings[key];
      if (dbCol && val !== undefined) {
        queryParams.push(val);
        updateClauses.push(`${dbCol} = $${queryParams.length}`);
      }
    });

    if (updateClauses.length === 0) {
      return reply.status(400).send({ error: 'No update parameters provided' });
    }

    queryParams.push(id);
    const updateQuery = `UPDATE battles SET ${updateClauses.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${queryParams.length} RETURNING *`;
    
    const result = await pool.query(updateQuery, queryParams);
    return reply.send({
      message: 'Battle updated successfully',
      battle: result.rows[0]
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to update battle' });
  }
}

export async function deleteBattle(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  const { id } = request.params as BattleParams;

  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  try {
    const ownershipRes = await pool.query('SELECT created_by, host_id FROM battles WHERE id = $1', [id]);
    if (ownershipRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Battle not found' });
    }

    const battle = ownershipRes.rows[0];
    const isAdmin = user.roles.includes('admin');
    const isOwner = battle.host_id === user.userId || battle.created_by === user.userId;

    if (!isAdmin && !isOwner) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this battle' });
    }

    await pool.query('DELETE FROM battles WHERE id = $1', [id]);
    return reply.send({ message: 'Battle deleted successfully' });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to delete battle' });
  }
}

export async function listRegistrationsForBattle(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as BattleParams;

  try {
    const entries = await pool.query(
      `SELECT be.*, dp.stage_name, dp.crew_name, dp.primary_style, dp.skill_level, up.first_name, up.last_name, up.email
       FROM battle_entries be
       JOIN dancer_profiles dp ON be.dancer_id = dp.id
       JOIN user_profiles up ON be.user_id = up.id
       WHERE be.battle_id = $1
       ORDER BY be.submitted_at ASC`,
      [id]
    );

    return reply.send(entries.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to list registrations' });
  }
}

export async function updateRegistrationStatus(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const user = request.user;
  const { id } = request.params as EntryParams;
  const { entryStatus } = request.body as UpdateEntryStatusBody;

  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  if (!entryStatus) {
    return reply.status(400).send({ error: 'entryStatus is required' });
  }

  try {
    // Verify entry exists and user is host of that battle
    const checkRes = await pool.query(
      `SELECT be.battle_id, b.host_id, b.created_by 
       FROM battle_entries be
       JOIN battles b ON be.battle_id = b.id
       WHERE be.id = $1`,
      [id]
    );

    if (checkRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Battle registration entry not found' });
    }

    const battle = checkRes.rows[0];
    const isAdmin = user.roles.includes('admin');
    const isOwner = battle.host_id === user.userId || battle.created_by === user.userId;

    if (!isAdmin && !isOwner) {
      return reply.status(403).send({ error: 'Forbidden: You do not own the battle associated with this entry' });
    }

    // Update status. Relational counts will auto-adjust via PG trigger
    const updateRes = await pool.query(
      `UPDATE battle_entries 
       SET entry_status = $1::entry_status, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $2, submitted_at = CURRENT_TIMESTAMP
       WHERE id = $3
       RETURNING *`,
      [entryStatus, user.userId, id]
    );

    return reply.send({
      message: `Registration status updated to ${entryStatus} successfully`,
      entry: updateRes.rows[0]
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to update registration status' });
  }
}
