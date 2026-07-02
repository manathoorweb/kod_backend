import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';

async function runMigrations() {
  console.log('Starting database migrations...');
  const migrationsDir = path.join(__dirname, '../../migrations');

  try {
    if (!fs.existsSync(migrationsDir)) {
      throw new Error(`Migrations directory not found at: ${migrationsDir}`);
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort(); // Sorts files alphabetically (e.g. 001_..., 002_...)

    if (files.length === 0) {
      console.log('No migration files found to execute.');
      return;
    }

    console.log(`Found ${files.length} migration files. Executing...`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      console.log(`Running migration: ${file}...`);
      
      const sql = fs.readFileSync(filePath, 'utf8');
      await pool.query(sql);
      
      console.log(`Completed migration: ${file}`);
    }
    
    console.log('Database migrations completed successfully!');
  } catch (err: any) {
    console.error('Migration failed:', err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
