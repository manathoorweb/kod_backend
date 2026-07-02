import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

interface RegisterForBattleBody {
  battleId: string;
  stageName: string;
  crewName?: string;
  yearsExperience: number;
  primaryStyle: string;
  secondaryStyles?: string[];
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'professional';
  videoLink: string;
  travelWillingness?: string;
  socialMediaLink?: string;
}

/**
 * Controller handling dancer registrations for battle events
 */
export async function registerForBattle(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const user = request.user;
  if (!user) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const {
    battleId,
    stageName,
    crewName,
    yearsExperience,
    primaryStyle,
    secondaryStyles,
    skillLevel,
    videoLink,
    travelWillingness,
    socialMediaLink,
  } = request.body as RegisterForBattleBody;

  if (!battleId || !stageName || !primaryStyle || !skillLevel || !videoLink) {
    return reply.status(400).send({ error: 'Required fields: battleId, stageName, primaryStyle, skillLevel, videoLink' });
  }

  try {
    // 1. Verify battle exists and is open
    const battleRes = await pool.query('SELECT status, participants_count, max_participants FROM battles WHERE id = $1', [battleId]);
    if (battleRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Battle not found' });
    }

    const battle = battleRes.rows[0];
    if (battle.status !== 'upcoming' && battle.status !== 'live') {
      return reply.status(400).send({ error: 'Registrations are closed for this battle' });
    }

    if (battle.participants_count >= battle.max_participants) {
      return reply.status(400).send({ error: 'This battle has reached the maximum number of registrations' });
    }

    // 2. Fetch or create dancer profile
    let dancerRes = await pool.query('SELECT id FROM dancer_profiles WHERE user_id = $1', [user.userId]);
    let dancerId;

    if (dancerRes.rows.length === 0) {
      const newDancerRes = await pool.query(
        `INSERT INTO dancer_profiles (user_id, stage_name, crew_name, years_experience, primary_style, secondary_styles, skill_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [user.userId, stageName, crewName || null, yearsExperience, primaryStyle, secondaryStyles || [], skillLevel]
      );
      dancerId = newDancerRes.rows[0].id;
    } else {
      dancerId = dancerRes.rows[0].id;
      // Optionally update dancer profile with latest details
      await pool.query(
        `UPDATE dancer_profiles 
         SET stage_name = $1, crew_name = $2, years_experience = $3, primary_style = $4, secondary_styles = $5, skill_level = $6, updated_at = CURRENT_TIMESTAMP
         WHERE id = $7`,
        [stageName, crewName || null, yearsExperience, primaryStyle, secondaryStyles || [], skillLevel, dancerId]
      );
    }

    // 3. Check for existing entry
    const entryRes = await pool.query(
      'SELECT id FROM battle_entries WHERE battle_id = $1 AND dancer_id = $2',
      [battleId, dancerId]
    );

    if (entryRes.rows.length > 0) {
      return reply.status(409).send({ error: 'You are already registered for this battle' });
    }

    // 4. Create battle entry
    const newEntryRes = await pool.query(
      `INSERT INTO battle_entries (battle_id, dancer_id, user_id, video_link, travel_willingness, social_media_link)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [battleId, dancerId, user.userId, videoLink, travelWillingness || null, socialMediaLink || null]
    );

    return reply.status(201).send({
      message: 'Registered for battle successfully',
      entry: newEntryRes.rows[0],
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to complete registration' });
  }
}

export async function getMyRegistrations(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  try {
    const registrations = await pool.query(
      `SELECT be.*, b.title as battle_title, b.battle_date, b.location, b.status as battle_status
       FROM battle_entries be
       JOIN battles b ON be.battle_id = b.id
       WHERE be.user_id = $1
       ORDER BY be.submitted_at DESC`,
      [user.userId]
    );
    return reply.send(registrations.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve registrations' });
  }
}
