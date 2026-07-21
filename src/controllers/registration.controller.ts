import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db';

interface RegistrationData {
  battleId: string;
  personalInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    country: string;
    city: string;
  };
  dancerProfile: {
    stageName: string;
    crewName?: string;
    yearsExperience: string | number;
    primaryStyle: string;
    secondaryStyles?: string[];
    skillLevel: string;
    profilePhoto?: string;
    dateOfBirth?: string;
    instagramTag?: string;
  };
  battlePreferences: {
    preferredFormats: string[];
    availableDates: string[];
    travelWillingness: string;
    categoryInterest: string[];
  };
  verification: {
    battleHistory: string;
    videoLink: string;
    references: string;
    socialMedia: string;
  };
  initialStatus?: 'pending' | 'approved';
}

/**
 * Controller handling dancer registrations for battle events
 */
export async function registerForBattle(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const data = request.body as RegistrationData;
  const { battleId, personalInfo, dancerProfile, battlePreferences, verification, initialStatus } = data;

  if (!battleId || !personalInfo || !dancerProfile || !battlePreferences || !verification) {
    return reply.status(400).send({ error: 'Missing registration details' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Verify battle exists and is open
    const battleRes = await client.query(
      'SELECT status, participants_count, max_participants FROM battles WHERE id = $1 FOR UPDATE',
      [battleId]
    );
    if (battleRes.rows.length === 0) {
      throw new Error('Battle not found');
    }

    const battle = battleRes.rows[0];
    if (battle.status !== 'upcoming' && battle.status !== 'live') {
      throw new Error('Registrations are closed for this battle');
    }

    if (battle.participants_count >= battle.max_participants) {
      throw new Error('This battle has reached the maximum number of registrations');
    }

    // 2. Update user profile
    await client.query(
      `UPDATE user_profiles 
       SET first_name = $1, last_name = $2, phone = $3, date_of_birth = $4, gender = $5::gender_type, country = $6, city = $7, updated_at = NOW()
       WHERE id = $8`,
      [
        personalInfo.firstName,
        personalInfo.lastName,
        personalInfo.phone,
        personalInfo.dateOfBirth || null,
        personalInfo.gender ? personalInfo.gender.replace('-', '_') : null,
        personalInfo.country,
        personalInfo.city,
        user.userId
      ]
    );

    // 3. Create or update dancer profile
    let dancerRes = await client.query('SELECT id FROM dancer_profiles WHERE user_id = $1', [user.userId]);
    let dancerId;
    const yearsExp = parseInt(dancerProfile.yearsExperience as string, 10) || 0;
    const dob = dancerProfile.dateOfBirth || personalInfo.dateOfBirth || null;
    const instagramTag = dancerProfile.instagramTag || null;

    if (dancerRes.rows.length === 0) {
      const newDancerRes = await client.query(
        `INSERT INTO dancer_profiles (user_id, stage_name, crew_name, years_experience, primary_style, secondary_styles, skill_level, profile_photo, date_of_birth, instagram_tag, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::skill_level, $8, $9, $10, NOW(), NOW())
         RETURNING id`,
        [
          user.userId,
          dancerProfile.stageName,
          dancerProfile.crewName || null,
          yearsExp,
          dancerProfile.primaryStyle,
          dancerProfile.secondaryStyles || [],
          dancerProfile.skillLevel,
          dancerProfile.profilePhoto || '',
          dob,
          instagramTag
        ]
      );
      dancerId = newDancerRes.rows[0].id;
    } else {
      dancerId = dancerRes.rows[0].id;
      await client.query(
        `UPDATE dancer_profiles 
         SET stage_name = $1, crew_name = $2, years_experience = $3, primary_style = $4, secondary_styles = $5, skill_level = $6::skill_level, profile_photo = $7, date_of_birth = $8, instagram_tag = $9, updated_at = NOW()
         WHERE id = $10`,
        [
          dancerProfile.stageName,
          dancerProfile.crewName || null,
          yearsExp,
          dancerProfile.primaryStyle,
          dancerProfile.secondaryStyles || [],
          dancerProfile.skillLevel,
          dancerProfile.profilePhoto || '',
          dob,
          instagramTag,
          dancerId
        ]
      );
    }

    // 4. Check for existing entry
    const entryRes = await client.query(
      'SELECT id FROM battle_entries WHERE battle_id = $1 AND dancer_id = $2',
      [battleId, dancerId]
    );

    if (entryRes.rows.length > 0) {
      throw new Error('You are already registered for this battle');
    }

    // 5. Create battle entry
    const formattedDates = (battlePreferences.availableDates || []).map(
      (d) => new Date(d).toISOString().split('T')[0]
    );

    const newEntryRes = await client.query(
      `INSERT INTO battle_entries (
        battle_id, dancer_id, user_id, preferred_formats, available_dates, 
        travel_willingness, category_interest, battle_history, video_link, 
        references_text, social_media_link, entry_status, submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::entry_status, NOW())
      RETURNING *`,
      [
        battleId,
        dancerId,
        user.userId,
        battlePreferences.preferredFormats || [],
        formattedDates,
        battlePreferences.travelWillingness || '',
        battlePreferences.categoryInterest || [],
        verification.battleHistory || '',
        verification.videoLink || '',
        verification.references || '',
        verification.socialMedia || '',
        initialStatus || 'pending'
      ]
    );

    await client.query('COMMIT');

    return reply.status(201).send({
      success: true,
      message: 'Registered for battle successfully',
      entry: newEntryRes.rows[0],
      dancerProfile: { id: dancerId }
    });
  } catch (err: any) {
    await client.query('ROLLBACK');
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to complete registration' });
  } finally {
    client.release();
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

export async function getDancerProfile(request: FastifyRequest, reply: FastifyReply) {
  const { userId } = request.params as { userId: string };
  try {
    const result = await pool.query(
      `SELECT dp.*, 
              json_build_object(
                'id', up.id, 'email', up.email, 'first_name', up.first_name, 
                'last_name', up.last_name, 'phone', up.phone, 'date_of_birth', up.date_of_birth,
                'gender', up.gender, 'country', up.country, 'city', up.city, 'roles', up.roles
              ) as user
       FROM dancer_profiles dp
       JOIN user_profiles up ON dp.user_id = up.id
       WHERE dp.user_id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Dancer profile not found' });
    }
    return reply.send(result.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve dancer profile' });
  }
}

export async function getAllDancerProfiles(request: FastifyRequest, reply: FastifyReply) {
  try {
    const result = await pool.query(
      `SELECT dp.*, 
              json_build_object(
                'id', up.id, 'email', up.email, 'first_name', up.first_name, 
                'last_name', up.last_name, 'phone', up.phone, 'date_of_birth', up.date_of_birth,
                'gender', up.gender, 'country', up.country, 'city', up.city, 'roles', up.roles
              ) as user
       FROM dancer_profiles dp
       JOIN user_profiles up ON dp.user_id = up.id
       ORDER BY dp.global_rank ASC NULLS LAST`
    );
    return reply.send(result.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve dancer profiles' });
  }
}

export async function updateDancerProfile(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  const { userId } = request.params as { userId: string };
  if (!user) return reply.status(401).send({ error: 'Unauthorized' });

  // Only allowed to update own profile unless admin
  if (user.userId !== userId && !user.roles.includes('admin')) {
    return reply.status(403).send({ error: 'Forbidden' });
  }

  const updates = request.body as any;

  try {
    // 1. Check if dancer profile already exists
    const dancerCheck = await pool.query('SELECT id FROM dancer_profiles WHERE user_id = $1', [userId]);
    let finalProfile;

    if (dancerCheck.rows.length === 0) {
      // Create new profile (insert)
      const insertRes = await pool.query(
        `INSERT INTO dancer_profiles (user_id, stage_name, crew_name, years_experience, primary_style, secondary_styles, skill_level, profile_photo, wins, global_rank, signature_move, bio, social_media, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::skill_level, $8, $9, $10, $11, $12, $13, NOW(), NOW())
         RETURNING *`,
        [
          userId,
          updates.stage_name || updates.stageName || '',
          updates.crew_name || updates.crewName || null,
          parseInt(updates.years_experience || updates.yearsExperience || 0, 10),
          updates.primary_style || updates.primaryStyle || '',
          updates.secondary_styles || updates.secondaryStyles || [],
          updates.skill_level || updates.skillLevel || 'beginner',
          updates.profile_photo || updates.profilePhoto || '',
          parseInt(updates.wins || 0, 10),
          updates.global_rank || updates.globalRank || null,
          updates.signature_move || updates.signatureMove || null,
          updates.bio || null,
          updates.social_media || updates.socialMedia || '{}'
        ]
      );
      finalProfile = insertRes.rows[0];
    } else {
      // Update existing profile
      const fieldsToUpdate: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      const allowedFields = [
        'stage_name', 'crew_name', 'years_experience', 'primary_style', 
        'secondary_styles', 'skill_level', 'profile_photo', 'wins', 
        'global_rank', 'signature_move', 'bio', 'social_media'
      ];

      for (const field of allowedFields) {
        // Map camelCase from body updates to snake_case table columns if present
        let val = updates[field];
        if (val === undefined) {
          const camelField = field.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
          val = updates[camelField];
        }

        if (val !== undefined) {
          if (field === 'skill_level') {
            fieldsToUpdate.push(`${field} = $${paramIndex}::skill_level`);
          } else {
            fieldsToUpdate.push(`${field} = $${paramIndex}`);
          }
          values.push(val);
          paramIndex++;
        }
      }

      if (fieldsToUpdate.length > 0) {
        values.push(userId);
        const updateRes = await pool.query(
          `UPDATE dancer_profiles 
           SET ${fieldsToUpdate.join(', ')}, updated_at = NOW() 
           WHERE user_id = $${paramIndex} 
           RETURNING *`,
          values
        );
        finalProfile = updateRes.rows[0];
      } else {
        finalProfile = dancerCheck.rows[0];
      }
    }

    // 2. Mark full_info = true in user_profiles
    await pool.query('UPDATE user_profiles SET full_info = true WHERE id = $1', [userId]);

    return reply.send(finalProfile);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to update dancer profile' });
  }
}

interface ProgramRegistrationData {
  orderId?: string;
  programId: string;
  personalInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    dateOfBirth: string;
    gender: string;
    country: string;
    city: string;
  };
  dancerProfile?: {
    stageName: string;
    crewName?: string;
    yearsExperience: string | number;
    primaryStyle: string;
    secondaryStyles?: string[];
    skillLevel: string;
    profilePhoto?: string;
    dateOfBirth?: string;
    instagramTag?: string;
  };
  stayPreferences?: {
    needStay: boolean;
    stayLocation: string;
  };
  battlePreferences?: {
    preferredFormats: string[];
    availableDates: string[];
    travelWillingness: string;
    categoryInterest: string[];
  };
  verification?: {
    battleHistory: string;
    videoLink: string;
    references: string;
    socialMedia: string;
  };
  selectedBattles?: string[];
  selectedWorkshops?: string[];
  selectedTickets?: { day: string; quantity: number; price: number }[];
  initialStatus?: 'pending' | 'approved';
}

export async function registerForProgram(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const data = request.body as ProgramRegistrationData;
  const {
    orderId,
    programId,
    personalInfo,
    dancerProfile,
    stayPreferences,
    battlePreferences,
    verification,
    selectedBattles = [],
    selectedWorkshops = [],
    selectedTickets = [],
    initialStatus = 'pending'
  } = data;

  if (!programId || !personalInfo) {
    return reply.status(400).send({ error: 'Program ID and personal info are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Update user profile
    await client.query(
      `UPDATE user_profiles 
       SET first_name = $1, last_name = $2, phone = $3, date_of_birth = $4, gender = $5::gender_type, country = $6, city = $7, updated_at = NOW()
       WHERE id = $8`,
      [
        personalInfo.firstName,
        personalInfo.lastName,
        personalInfo.phone,
        personalInfo.dateOfBirth || null,
        personalInfo.gender ? personalInfo.gender.replace('-', '_') : null,
        personalInfo.country,
        personalInfo.city,
        user.userId
      ]
    );

    // 2. Create or update dancer profile if dancerProfile fields are provided (needed for battle entries)
    let dancerId = null;
    if (dancerProfile && dancerProfile.stageName) {
      const yearsExp = parseInt(dancerProfile.yearsExperience as string, 10) || 0;
      const dob = dancerProfile.dateOfBirth || personalInfo.dateOfBirth || null;
      const instagramTag = dancerProfile.instagramTag || null;
      let dancerRes = await client.query('SELECT id FROM dancer_profiles WHERE user_id = $1', [user.userId]);
      if (dancerRes.rows.length === 0) {
        const newDancerRes = await client.query(
          `INSERT INTO dancer_profiles (user_id, stage_name, crew_name, years_experience, primary_style, secondary_styles, skill_level, profile_photo, date_of_birth, instagram_tag, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::skill_level, $8, $9, $10, NOW(), NOW())
           RETURNING id`,
          [
            user.userId,
            dancerProfile.stageName,
            dancerProfile.crewName || null,
            yearsExp,
            dancerProfile.primaryStyle,
            dancerProfile.secondaryStyles || [],
            dancerProfile.skillLevel,
            dancerProfile.profilePhoto || '',
            dob,
            instagramTag
          ]
        );
        dancerId = newDancerRes.rows[0].id;
      } else {
        dancerId = dancerRes.rows[0].id;
        await client.query(
          `UPDATE dancer_profiles 
           SET stage_name = $1, crew_name = $2, years_experience = $3, primary_style = $4, secondary_styles = $5, skill_level = $6::skill_level, profile_photo = $7, date_of_birth = $8, instagram_tag = $9, updated_at = NOW()
           WHERE id = $10`,
          [
            dancerProfile.stageName,
            dancerProfile.crewName || null,
            yearsExp,
            dancerProfile.primaryStyle,
            dancerProfile.secondaryStyles || [],
            dancerProfile.skillLevel,
            dancerProfile.profilePhoto || '',
            dob,
            instagramTag,
            dancerId
          ]
        );
      }
    }

    // 3. Register for Battles
    if (dancerId && selectedBattles.length > 0) {
      for (const battleId of selectedBattles) {
        // Verify battle is open
        const battleRes = await client.query('SELECT max_participants, participants_count FROM battles WHERE id = $1', [battleId]);
        if (battleRes.rows.length > 0) {
          // Check uniqueness
          const entryCheck = await client.query('SELECT id FROM battle_entries WHERE battle_id = $1 AND dancer_id = $2', [battleId, dancerId]);
          if (entryCheck.rows.length === 0) {
            const formattedDates = ((battlePreferences && battlePreferences.availableDates) || []).map(
              (d) => new Date(d).toISOString().split('T')[0]
            );
            await client.query(
              `INSERT INTO battle_entries (
                battle_id, dancer_id, user_id, preferred_formats, available_dates, 
                travel_willingness, category_interest, battle_history, video_link, 
                references_text, social_media_link, entry_status, submitted_at,
                need_stay, stay_location
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::entry_status, NOW(), $13, $14)`,
              [
                battleId,
                dancerId,
                user.userId,
                (battlePreferences && battlePreferences.preferredFormats) || [],
                formattedDates,
                (battlePreferences && battlePreferences.travelWillingness) || '',
                (battlePreferences && battlePreferences.categoryInterest) || [],
                (verification && verification.battleHistory) || '',
                (verification && verification.videoLink) || '',
                (verification && verification.references) || '',
                (verification && verification.socialMedia) || '',
                initialStatus,
                stayPreferences?.needStay || false,
                stayPreferences?.stayLocation || ''
              ]
            );
          }
        }
      }
    }

    // 4. Register for Workshops
    if (selectedWorkshops.length > 0) {
      for (const workshopId of selectedWorkshops) {
        await client.query(
          `INSERT INTO workshop_bookings (workshop_id, user_id)
           VALUES ($1, $2)
           ON CONFLICT (workshop_id, user_id) DO NOTHING`,
          [workshopId, user.userId]
        );
      }
    }

    // 5. Order Tickets
    if (selectedTickets.length > 0) {
      for (const ticket of selectedTickets) {
        await client.query(
          `INSERT INTO ticket_orders (program_id, user_id, day, price, quantity, status, order_id)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
          [programId, user.userId, ticket.day, ticket.price, ticket.quantity, orderId || null]
        );
      }
    }

    await client.query('COMMIT');
    client.release();
    return reply.status(201).send({ success: true, message: 'Program registration processed successfully' });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to process registration' });
  }
}
