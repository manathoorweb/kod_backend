import fs from 'fs';
import path from 'path';
import { pool } from '../config/db';

async function runMigrations() {
  console.log('Starting database migrations...');
  const migrationPath = path.join(__dirname, '../../migrations/001_init_schema.sql');

  try {
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`Migration file not found at: ${migrationPath}`);
    }

    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('Connecting to database and running migration script...');
    await pool.query(sql);
    
    console.log('Database migrations completed successfully!');
  } catch (err: any) {
    console.error('Migration failed:', err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
