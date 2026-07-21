import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '../config/db.js';

interface BattleFormatInput {
  name: string;
  registrationFee: number;
}

interface WorkshopInput {
  name: string;
  price: number;
}

interface CreateProgramBody {
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  location: string;
  country?: string;
  status?: string;
  imageUrl?: string;
  includeBattles: boolean;
  selectedFormats?: (string | BattleFormatInput)[]; // Array of format names or objects with fee
  includeWorkshops: boolean;
  workshopNames?: (string | WorkshopInput)[]; // Array of names or objects with price
  ticketPrices?: any[];
}

export async function createProgram(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user || !user.roles.includes('admin')) {
    return reply.status(403).send({ error: 'Forbidden: Admin access required' });
  }

  const {
    title,
    description,
    startDate,
    endDate,
    location,
    country,
    status,
    imageUrl,
    includeBattles,
    selectedFormats,
    includeWorkshops,
    workshopNames,
    ticketPrices
  } = request.body as CreateProgramBody;

  if (!title || !startDate || !location) {
    return reply.status(400).send({ error: 'Title, Start Date, and Location are required' });
  }

  try {
    // Start transaction
    await pool.query('BEGIN');

    // 1. Insert Program
    const programRes = await pool.query(
      `INSERT INTO programs (title, description, start_date, end_date, location, country, status, image_url, ticket_prices, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *`,
      [title, description || null, startDate, endDate || null, location, country || 'India', status || 'upcoming', imageUrl || null, JSON.stringify(ticketPrices || [])]
    );
    const program = programRes.rows[0];

    // 2. Add Battles (Formats) if selected
    if (includeBattles && Array.isArray(selectedFormats) && selectedFormats.length > 0) {
      for (const format of selectedFormats) {
        const name = typeof format === 'string' ? format : format.name;
        const fee = typeof format === 'string' ? 0.00 : (format.registrationFee || 0.00);
        const categoryName = name.split(' - ')[0].toLowerCase().trim().replace(/\s+/g, '-');
        await pool.query(
          `INSERT INTO battles (title, category, battle_date, location, battle_format, program_id, created_by, prize_pool, max_participants, registration_fee, ticket_price, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
          [
            `${title} - ${name}`,
            categoryName,
            startDate,
            location,
            name,
            program.id,
            user.userId,
            'TBD',
            32,
            fee,
            0.00,
            status || 'upcoming'
          ]
        );
      }
    }

    // 3. Add Workshops if selected
    if (includeWorkshops && Array.isArray(workshopNames) && workshopNames.length > 0) {
      for (const item of workshopNames) {
        const name = typeof item === 'string' ? item : item.name;
        const price = typeof item === 'string' ? 0.00 : (item.price || 0.00);
        if (name.trim()) {
          await pool.query(
            `INSERT INTO workshops (program_id, name, price, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())`,
            [program.id, name.trim(), price]
          );
        }
      }
    }

    await pool.query('COMMIT');
    return reply.status(201).send({ success: true, program });
  } catch (err: any) {
    await pool.query('ROLLBACK').catch(() => {});
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to create program' });
  }
}

export async function listPrograms(request: FastifyRequest, reply: FastifyReply) {
  try {
    const result = await pool.query(
      `SELECT p.*,
              COALESCE(
                (SELECT json_agg(b.*) FROM battles b WHERE b.program_id = p.id), '[]'
              ) as battles,
              COALESCE(
                (SELECT json_agg(w.*) FROM workshops w WHERE w.program_id = p.id), '[]'
              ) as workshops
       FROM programs p
       ORDER BY p.start_date DESC`
    );
    return reply.send(result.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve programs' });
  }
}

export async function getProgramById(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  try {
    let result = await pool.query(
      `SELECT p.*,
              COALESCE(
                (SELECT json_agg(b.*) FROM battles b WHERE b.program_id = p.id), '[]'
              ) as battles,
              COALESCE(
                (SELECT json_agg(w.*) FROM workshops w WHERE w.program_id = p.id), '[]'
              ) as workshops
       FROM programs p
       WHERE p.id = $1`,
      [id]
    );

    // Fallback: If not found, check if it's a battle ID and query parent program instead
    if (result.rows.length === 0) {
      const battleRes = await pool.query(
        `SELECT program_id FROM battles WHERE id = $1`,
        [id]
      );
      if (battleRes.rows.length > 0 && battleRes.rows[0].program_id) {
        result = await pool.query(
          `SELECT p.*,
                  COALESCE(
                    (SELECT json_agg(b.*) FROM battles b WHERE b.program_id = p.id), '[]'
                  ) as battles,
                  COALESCE(
                    (SELECT json_agg(w.*) FROM workshops w WHERE w.program_id = p.id), '[]'
                  ) as workshops
           FROM programs p
           WHERE p.id = $1`,
          [battleRes.rows[0].program_id]
        );
      }
    }

    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Program not found' });
    }
    return reply.send(result.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve program' });
  }
}

export async function listFormats(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Seed default formats first to guarantee database is always up-to-date
    await pool.query(`
      INSERT INTO battle_formats (name, description) VALUES
      ('Hip Hop - 1v1', 'Solo Hip Hop battle'),
      ('Hip Hop - 2v2', '2v2 Hip Hop battle'),
      ('Hip Hop - 16 to Burn', '16 to Burn Hip Hop battle'),
      ('All Styles - 1v1', 'Solo All Styles battle'),
      ('All Styles - 2v2', '2v2 All Styles battle'),
      ('All Styles - 16 to Burn', '16 to Burn All Styles battle'),
      ('Afro - 1v1', 'Solo Afro battle'),
      ('Afro - 16 to Burn', '16 to Burn Afro battle'),
      ('Popping - 1v1', 'Solo Popping battle'),
      ('Popping - 16 to Burn', '16 to Burn Popping battle'),
      ('Breaking Boys - 1v1', 'Solo Breaking Boys battle'),
      ('Breaking Boys - 2v2', '2v2 Breaking Boys battle'),
      ('Breaking Boys - 16 to Burn', '16 to Burn Breaking Boys battle'),
      ('Breaking Girls - 1v1', 'Solo Breaking Girls battle'),
      ('Breaking Girls - 2v2', '2v2 Breaking Girls battle'),
      ('Breaking Girls - 16 to Burn', '16 to Burn Breaking Girls battle')
      ON CONFLICT (name) DO NOTHING
    `);

    const result = await pool.query('SELECT * FROM battle_formats ORDER BY name ASC');
    return reply.send(result.rows);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve battle formats' });
  }
}

export async function createFormat(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user || !user.roles.includes('admin')) {
    return reply.status(403).send({ error: 'Forbidden: Admin access required' });
  }

  const { name, description } = request.body as { name: string; description?: string };
  if (!name) {
    return reply.status(400).send({ error: 'Format name is required' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO battle_formats (name, description, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
       RETURNING *`,
      [name.trim(), description || null]
    );
    return reply.status(201).send(result.rows[0]);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to save battle format' });
  }
}

export async function deleteProgram(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user || !user.roles.includes('admin')) {
    return reply.status(403).send({ error: 'Forbidden: Admin access required' });
  }

  const { id } = request.params as { id: string };
  try {
    const result = await pool.query('DELETE FROM programs WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return reply.status(404).send({ error: 'Program not found' });
    }
    return reply.send({ success: true, message: 'Program deleted successfully' });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to delete program' });
  }
}

export async function updateProgram(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user || !user.roles.includes('admin')) {
    return reply.status(403).send({ error: 'Forbidden: Admin access required' });
  }

  const { id } = request.params as { id: string };
  const {
    title,
    description,
    startDate,
    endDate,
    location,
    country,
    status,
    imageUrl,
    ticketPrices,
    includeBattles,
    selectedFormats,
    includeWorkshops,
    workshopNames
  } = request.body as CreateProgramBody;

  if (!title || !startDate || !location) {
    return reply.status(400).send({ error: 'Title, Start Date, and Location are required' });
  }

  try {
    await pool.query('BEGIN');

    // 1. Update Program
    const programRes = await pool.query(
      `UPDATE programs
       SET title = $1, description = $2, start_date = $3, end_date = $4, location = $5, country = $6, status = $7, image_url = $8, ticket_prices = $9, updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [title, description || null, startDate, endDate || null, location, country || 'India', status || 'upcoming', imageUrl || null, JSON.stringify(ticketPrices || []), id]
    );

    if (programRes.rows.length === 0) {
      await pool.query('ROLLBACK').catch(() => {});
      return reply.status(404).send({ error: 'Program not found' });
    }

    const program = programRes.rows[0];

    // 2. Clear old battles & workshops to recreate (simpler sync)
    await pool.query('DELETE FROM battles WHERE program_id = $1', [id]);
    await pool.query('DELETE FROM workshops WHERE program_id = $1', [id]);

    // 3. Add Battles (Formats) if selected
    if (includeBattles && Array.isArray(selectedFormats) && selectedFormats.length > 0) {
      for (const format of selectedFormats) {
        const name = typeof format === 'string' ? format : format.name;
        const fee = typeof format === 'string' ? 0.00 : (format.registrationFee || 0.00);
        const categoryName = name.split(' - ')[0].toLowerCase().trim().replace(/\s+/g, '-');
        await pool.query(
          `INSERT INTO battles (title, category, battle_date, location, battle_format, program_id, created_by, prize_pool, max_participants, registration_fee, ticket_price, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
          [
            `${title} - ${name}`,
            categoryName,
            startDate,
            location,
            name,
            program.id,
            user.userId,
            'TBD',
            32,
            fee,
            0.00,
            status || 'upcoming'
          ]
        );
      }
    }

    // 4. Add Workshops if selected
    if (includeWorkshops && Array.isArray(workshopNames) && workshopNames.length > 0) {
      for (const item of workshopNames) {
        const name = typeof item === 'string' ? item : item.name;
        const price = typeof item === 'string' ? 0.00 : (item.price || 0.00);
        if (name.trim()) {
          await pool.query(
            `INSERT INTO workshops (program_id, name, price, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())`,
            [program.id, name.trim(), price]
          );
        }
      }
    }

    await pool.query('COMMIT');
    return reply.send({ success: true, program });
  } catch (err: any) {
    await pool.query('ROLLBACK').catch(() => {});
    request.log.error(err);
    return reply.status(500).send({ error: err.message || 'Failed to update program' });
  }
}
