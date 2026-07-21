import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';

// AsyncLocalStorage to hold the active request's database client
export const dbStorage = new AsyncLocalStorage<any>();

// Force loading of the backend .env specifically, regardless of working directory
if (typeof __dirname !== 'undefined') {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }
} else {
  dotenv.config();
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('Warning: DATABASE_URL environment variable is not defined.');
}

const AIVEN_CA_CERT = `-----BEGIN CERTIFICATE-----
MIIERDCCAqygAwIBAgIUeT3HGLyP8cDgi/4JEI1XQjLJSqAwDQYJKoZIhvcNAQEM
BQAwOjE4MDYGA1UEAwwvNGYxYmI1ZDQtMDQyMC00ZGU4LWJkZjQtNWZjZmMxZjJm
YWI5IFByb2plY3QgQ0EwHhcNMjYwNzAyMTAyNTI2WhcNMzYwNjI5MTAyNTI2WjA6
MTgwNgYDVQQDDC80ZjFiYjVkNC0wNDIwLTRkZTgtYmRmNC01ZmNmYzFmMmZhYjkg
UHJvamVjdCBDQTCCAaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoCggGBAJqeASJN
4hFlY00k16U95iSnGxr0S2sUb0ZibG8E5ECJLjXqPdnDvLsYlgaTD61S43tswsU2
s+VFFxka55OFbbtUa83teN7e9XKwl1d+P4AVP6o9OzC8cGPpR06IK42gVnExNm7U
/Tnesly8l61uO6Mgb/gphLN58Zj/gorbQlVecRqOBu0aOsTXNSpjHEFlCnQj5+nb
51UON/kb2gHz4HWz9dw6Ksx1oZnCQoj/SyVHHJCoTMRnmfHQ6h4BxXrbHE87Z8Db
hCgUVHTCgujc6Jh2Hv0/NOGJLCMS7l5xuXw9HikI+cRqOkpTdCrJcP2JjSL/Uq61
+jDzoxahgKLyfTRCJga4+WeYroNsWy0yBXYhQO4FvxasuVRFc4+AZgb53+wrFp0G
EYQ04ImWBvLhpKUY8oil3nDTKcjZCU6Lt9kRUjhNlCpLA1PJaiS/Jr+Q2Uy9b1E2
SpNuJfN9pMhh6wmme80ymTUMtfukkK4rMPsIsGeNR8jAZGZuJ9qKSBqO8wIDAQAB
o0IwQDAdBgNVHQ4EFgQUjM70zG2UEjecDKkfoJJMqYtfcwEwEgYDVR0TAQH/BAgw
BgEB/wIBADALBgNVHQ8EBAMCAQYwDQYJKoZIhvcNAQEMBQADggGBAHFfBO6zm9iT
wkXMjRP9MC3Z2SvWx1mMbSGMmDOr0ElxLNolAfLN6t0JcUkDx7HoKw7/mYpseMkT
4HGcOSYtCJnNdJwFI5t6UiQjecI4scbThRGhoinmRnj0clI73k5DZgPNwe1A/l4E
FCOCdcKMpcoorErwg5HazHDPtn6+zv0KIU4C81N/9dOZJD1dJqzILKe+oHyVsM+o
3lJw46xHxfEWlYRo5Hod8FT8FmIh3Hm/9CGtSz9WudAK3NEMOiyUXDK+zQ4Uvrky
EMF0lRuc8rKCOnXZj7AZJU8KpX/CgVl9uisJveUY0zCtnIHLM8Go0Rqz7uoTdH3E
GaX9lhDZkIbwlOyQVG+v42lwVjlbIU0BTPkrbwv53o4vcBelwjgJa/e/f3teNl3b
wpQCDnFhv9E0DFSzH5Sa2h4jDXUSLsHbS9cYkbnbQPoMI4Il5arNLs9OeGF0rOyO
B/mxckZWxMG2F7uhh+R5khYfr6qrX5bsCHRDWE5FEuP3wFlcoCgfaA==
-----END CERTIFICATE-----`;

const isCloudDb = databaseUrl?.includes('aivencloud.com') || process.env.PGSSLROOTCERT;

// Enable SSL CA config for hosted Aiven or cloud PostgreSQL instances
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true';

export const sslConfig = isCloudDb
  ? {
      rejectUnauthorized,
      ca: AIVEN_CA_CERT,
    }
  : undefined;

// Strip SSL parameters from the connection string to prevent pg's parser from overriding our custom SSL config
export let cleanConnectionString = databaseUrl;
if (databaseUrl) {
  try {
    const parsedUrl = new URL(databaseUrl);
    parsedUrl.searchParams.delete('sslmode');
    parsedUrl.searchParams.delete('ssl');
    cleanConnectionString = parsedUrl.toString();
  } catch (err) {
    // If databaseUrl is not a valid URL, keep it as is
  }
}

// Lazy load pool to prevent errors during Worker initialization
let poolInstance: any = null;

function getPoolInstance() {
  if (!poolInstance) {
    const { Pool } = pg;
    poolInstance = new Pool({
      connectionString: cleanConnectionString,
      ssl: sslConfig,
      max: 10,                 // Capped to 10 to respect Aiven connection limits
      min: 0,                  // Allow scaling down to 0 to prevent issues with idle cloud DB connection drops
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 20000,
    });

    poolInstance.on('connect', (client: any) => {
      client.on('error', (err: any) => {
        console.error('Unexpected error on active database client:', err.message || err);
      });
    });

    poolInstance.on('error', (err: any) => {
      console.error('Unexpected error on idle database client:', err.message || err);
    });
  }
  return poolInstance;
}

// Mock pool object to maintain compatibility with controllers/scripts importing "pool"
export const pool = {
  async query(text: any, params?: any, callback?: any): Promise<pg.QueryResult<any>> {
    const client = dbStorage.getStore();
    if (!client) {
      return await getPoolInstance().query(text, params, callback);
    }
    return client.query(text, params, callback);
  },
  
  // Connect to maintain compatibility with controllers and background worker services
  async connect() {
    const client = dbStorage.getStore();
    if (client) {
      // Mock the release function for request-scoped clients as a no-op
      if (typeof (client as any).release !== 'function') {
        (client as any).release = () => {};
      }
      return client;
    }
    return await getPoolInstance().connect();
  },

  // End to maintain compatibility with migration scripts
  async end() {
    if (poolInstance) {
      await poolInstance.end().catch(() => {});
    }
  }
};

export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};
