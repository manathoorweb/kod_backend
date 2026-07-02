import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Force loading of the backend .env specifically
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'kod-default-access-secret-key-3029';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'kod-default-refresh-secret-key-9204';

export interface JWTPayload {
  userId: string;
  email: string;
  roles: string[];
}

/**
 * Sign a short-lived access token
 */
export function signAccessToken(payload: JWTPayload): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: '15m' });
}

/**
 * Sign a long-lived refresh token
 */
export function signRefreshToken(payload: JWTPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: '7d' });
}

/**
 * Verify access token and return payload
 */
export function verifyAccessToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, ACCESS_SECRET) as JWTPayload;
  } catch (err: any) {
    throw new Error('Invalid or expired access token');
  }
}

/**
 * Verify refresh token and return payload
 */
export function verifyRefreshToken(token: string): JWTPayload {
  try {
    return jwt.verify(token, REFRESH_SECRET) as JWTPayload;
  } catch (err: any) {
    throw new Error('Invalid or expired refresh token');
  }
}
