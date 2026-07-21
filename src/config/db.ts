import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

// AsyncLocalStorage to hold the active request's database client
export const dbStorage = new AsyncLocalStorage<any>();

// Force loading of the backend .env specifically, regardless of working directory
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const { Pool } = pg;

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('Warning: DATABASE_URL environment variable is not defined.');
}

const caPath = path.resolve(__dirname, '../../ca.pem');
const isCloudDb = databaseUrl?.includes('aivencloud.com') || process.env.PGSSLROOTCERT;

// Enable SSL CA config for hosted Aiven or cloud PostgreSQL instances
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true';

const sslConfig = isCloudDb
  ? {
      rejectUnauthorized,
      ca: fs.existsSync(caPath) ? fs.readFileSync(caPath, 'utf8') : undefined,
    }
  : undefined;

// Strip SSL parameters from the connection string to prevent pg's parser from overriding our custom SSL config
let cleanConnectionString = databaseUrl;
if (databaseUrl) {
  try {
    const parsedUrl = new URL(databaseUrl);
    parsedUrl.searchParams.delete('sslmode');
    parsedUrl.searchParams.delete('ssl');
    cleanConnectionString = parsedUrl.toString();
  } catch (err) {
    // If databaseUrl is not a valid URL (e.g. standard pg connection string), keep it as is
  }
}

// Debug logs to trace the connection parameter resolution
console.log('--- DB Connection Debug Logs ---');
console.log('Loaded .env path:', fs.existsSync(envPath) ? envPath : 'Default fallback');
console.log('Database URL:', databaseUrl ? databaseUrl.replace(/:[^:@]+@/, ':***@') : 'undefined');
console.log('Cleaned Connection URL:', cleanConnectionString ? cleanConnectionString.replace(/:[^:@]+@/, ':***@') : 'undefined');
console.log('CA Certificate Path:', caPath);
console.log('CA Certificate Exists:', fs.existsSync(caPath));
console.log('DB_SSL_REJECT_UNAUTHORIZED env value:', process.env.DB_SSL_REJECT_UNAUTHORIZED);
console.log('SSL Connection config:', sslConfig);
console.log('--------------------------------');

export const poolInstance = new Pool({
  connectionString: cleanConnectionString,
  ssl: sslConfig,
  max: 10,                 // Capped to 10 to respect Aiven connection limits
  min: 0,                  // Allow scaling down to 0 to prevent issues with idle cloud DB connection drops
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000, // Timeout after 20 seconds to allow for cloud cold starts/network latency
});

poolInstance.on('connect', (client) => {
  client.on('error', (err) => {
    console.error('Unexpected error on active database client:', err.message || err);
  });
});

poolInstance.on('error', (err) => {
  console.error('Unexpected error on idle database client:', err.message || err);
});

// Mock pool object to maintain compatibility with controllers/scripts importing "pool"
export const pool = {
  async query(text: any, params?: any, callback?: any): Promise<pg.QueryResult<any>> {
    const client = dbStorage.getStore();
    if (!client) {
      return (await poolInstance.query(text, params, callback)) as any;
    }
    return client.query(text, params, callback) as any;
  },
  
  // Connect to maintain compatibility with worker.service.ts
  async connect() {
    return await poolInstance.connect();
  },

  // End to maintain compatibility with migration scripts
  async end() {
    await poolInstance.end().catch(() => {});
  }
};

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};
