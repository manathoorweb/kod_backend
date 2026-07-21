import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../config/db.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, JWTPayload } from '../config/jwt.js';
import admin from '../config/firebase.js';

export function parseRoles(roles: any): string[] {
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  if (typeof roles === 'string') {
    return roles.replace(/[{}]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean);
  }
  return [];
}

export function getCookieOptions(request: FastifyRequest) {
  return {
    path: '/api/auth',
    httpOnly: true,
    secure: true,
    sameSite: 'none' as const,
    maxAge: 14 * 24 * 60 * 60,
  };
}

interface RegisterBody {
  email: string;
  password?: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: string;
  gender?: 'male' | 'female' | 'non_binary' | 'prefer_not_to_say';
  country?: string;
  city?: string;
}

interface LoginBody {
  email: string;
  password?: string;
}

interface FirebaseLoginBody {
  idToken: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  photoUrl?: string;
}

/**
 * Registers a new user with standard email/password credentials.
 * Implements clean transaction management and pre-computed password hashing.
 */
export async function register(request: FastifyRequest, reply: FastifyReply) {
  const { email, password, firstName, lastName, phone, dateOfBirth, gender, country, city } = request.body as RegisterBody;

  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }

  const traceId = crypto.randomBytes(4).toString('hex');
  console.log(`[Auth Register] [${traceId}] Initiating registration for: ${email}`);

  // 1. Compute hash and checks OUTSIDE the database transaction
  const passwordHash = await bcrypt.hash(password, 10);
  const userId = crypto.randomUUID();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`[Auth Register] [${traceId}] Transaction started.`);

    // Check if user already exists (FOR UPDATE to prevent concurrent inserts with the same email)
    const userCheck = await client.query('SELECT id FROM user_profiles WHERE email = $1 FOR UPDATE', [email]);
    if (userCheck.rows.length > 0) {
      console.warn(`[Auth Register] [${traceId}] Email registration conflict: ${email} already exists.`);
      await client.query('ROLLBACK');
      return reply.status(409).send({ error: 'A user with this email already exists' });
    }

    // Insert user profile
    console.log(`[Auth Register] [${traceId}] Inserting new user profile...`);
    await client.query(
      `INSERT INTO user_profiles (id, email, password_hash, first_name, last_name, phone, date_of_birth, gender, country, city)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [userId, email, passwordHash, firstName, lastName || null, phone || null, dateOfBirth || null, gender || null, country || null, city || null]
    );

    const payload: JWTPayload = { userId, email, roles: ['dancer'] };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
    console.log(`[Auth Register] [${traceId}] Storing refresh token...`);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, refreshToken, expiresAt]
    );

    await client.query('COMMIT');
    console.log(`[Auth Register] [${traceId}] Registration transaction committed successfully.`);

    reply.setCookie('refreshToken', refreshToken, getCookieOptions(request));

    return reply.status(201).send({
      message: 'User registered successfully',
      accessToken,
      user: { id: userId, email, firstName, roles: ['dancer'], fullInfo: false, phone: phone || null }
    });
  } catch (err: any) {
    console.error(`[Auth Register] [${traceId}] Registration failed:`, err.message || err);
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {}
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error during registration' });
  } finally {
    client.release();
  }
}

/**
 * Standard password authentication login.
 */
export async function login(request: FastifyRequest, reply: FastifyReply) {
  const { email, password } = request.body as LoginBody;

  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }

  const traceId = crypto.randomBytes(4).toString('hex');
  console.log(`[Auth Login] [${traceId}] Initiating password login for: ${email}`);

  const client = await pool.connect();
  try {
    // 1. Fetch user data (outside transaction to avoid unnecessary database locks on incorrect passwords)
    const userRes = await client.query('SELECT * FROM user_profiles WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const user = userRes.rows[0];
    if (!user.password_hash) {
      return reply.status(400).send({ error: 'This account uses social sign-in. Please log in with Google.' });
    }

    // 2. Perform bcrypt compare OUTSIDE database transaction
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const userRoles = parseRoles(user.roles);
    const payload: JWTPayload = { userId: user.id, email: user.email, roles: userRoles };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // 3. Write refresh token inside a clean transaction
    await client.query('BEGIN');
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );
    await client.query('COMMIT');
    console.log(`[Auth Login] [${traceId}] Login transaction committed successfully for user ID: ${user.id}`);

    reply.setCookie('refreshToken', refreshToken, getCookieOptions(request));

    return reply.send({
      accessToken,
      user: { id: user.id, email: user.email, firstName: user.first_name, roles: userRoles, fullInfo: user.full_info, phone: user.phone }
    });
  } catch (err: any) {
    console.error(`[Auth Login] [${traceId}] Login failed:`, err.message || err);
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {}
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error during login' });
  } finally {
    client.release();
  }
}

/**
 * Firebase ID Token verification and profile synchronization.
 * Uses strict row locks (FOR UPDATE) to prevent concurrent registration deadlocks.
 */
export async function firebaseLogin(request: FastifyRequest, reply: FastifyReply) {
  const { idToken, firstName: bodyFirstName, lastName: bodyLastName, phone: bodyPhone, photoUrl: bodyPhotoUrl } = request.body as FirebaseLoginBody;

  if (!idToken) {
    return reply.status(400).send({ error: 'Firebase ID Token is required' });
  }

  const traceId = crypto.randomBytes(4).toString('hex');
  console.log(`[Firebase Login] [${traceId}] Verifying ID token...`);

  // 1. Verify Firebase token OUTSIDE the database transaction
  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken) as any;
  } catch (verifyErr: any) {
    console.error(`[Firebase Login] [${traceId}] Verification failed:`, verifyErr.message || verifyErr);
    return reply.status(401).send({ error: verifyErr.message || 'Invalid Firebase ID Token configuration' });
  }

  const { uid, email, name, picture } = decodedToken;
  if (!email) {
    return reply.status(400).send({ error: 'Firebase token is missing email profile scope' });
  }

  console.log(`[Firebase Login] [${traceId}] Token verified. UID: ${uid}, Email: ${email}`);

  const splitName = name ? name.split(' ') : ['GoogleUser', ''];
  const firstName = bodyFirstName || splitName[0];
  const lastName = bodyLastName || splitName.slice(1).join(' ') || null;
  const phone = bodyPhone || null;
  const photoUrl = bodyPhotoUrl || picture || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`[Firebase Login] [${traceId}] Transaction started.`);

    // 2. Lock existing records for UID or Email to prevent deadlocks and insert race conditions
    console.log(`[Firebase Login] [${traceId}] Querying user profile with lock...`);
    const lockRes = await client.query(
      `SELECT * FROM user_profiles WHERE id = $1 OR email = $2 FOR UPDATE`,
      [uid, email]
    );

    let user;

    if (lockRes.rows.length === 0) {
      // User doesn't exist at all, insert new record
      console.log(`[Firebase Login] [${traceId}] User not found. Creating new user profile...`);
      const insertRes = await client.query(
        `INSERT INTO user_profiles (id, email, first_name, last_name, phone, photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [uid, email, firstName, lastName, phone, photoUrl]
      );
      user = insertRes.rows[0];
    } else {
      // User exists
      const matchedUser = lockRes.rows[0];
      
      if (matchedUser.id === uid) {
        // Exact match by UID, update details if empty
        console.log(`[Firebase Login] [${traceId}] UID match found. Syncing details...`);
        const updateRes = await client.query(
          `UPDATE user_profiles 
           SET email = $1,
               first_name = COALESCE(first_name, $2),
               last_name = COALESCE(last_name, $3),
               phone = COALESCE(phone, $4),
               photo_url = COALESCE(photo_url, $5),
               updated_at = NOW()
           WHERE id = $6
           RETURNING *`,
          [email, firstName, lastName, phone, photoUrl, uid]
        );
        user = updateRes.rows[0];
      } else {
        // Email match but different ID (e.g. user registered previously via email/password, now uses Google)
        // We migrate the ID to Firebase UID to link accounts
        console.log(`[Firebase Login] [${traceId}] Email match with different ID (${matchedUser.id}). Linking accounts to UID (${uid})...`);
        const updateRes = await client.query(
          `UPDATE user_profiles 
           SET id = $1, 
               first_name = COALESCE(first_name, $3),
               last_name = COALESCE(last_name, $4),
               phone = COALESCE(phone, $5),
               photo_url = COALESCE(photo_url, $6),
               updated_at = NOW()
           WHERE email = $2
           RETURNING *`,
          [uid, email, firstName, lastName, phone, photoUrl]
        );
        user = updateRes.rows[0];
      }
    }

    const userRoles = parseRoles(user.roles);
    const payload: JWTPayload = { userId: user.id, email: user.email, roles: userRoles };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    console.log(`[Firebase Login] [${traceId}] Saving refresh token...`);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );

    await client.query('COMMIT');
    console.log(`[Firebase Login] [${traceId}] Transaction committed successfully.`);

    reply.setCookie('refreshToken', refreshToken, getCookieOptions(request));

    return reply.send({
      accessToken,
      user: { 
        id: user.id, 
        email: user.email, 
        firstName: user.first_name, 
        lastName: user.last_name,
        roles: userRoles, 
        fullInfo: user.full_info, 
        phone: user.phone,
        photoUrl: user.photo_url
      }
    });
  } catch (err: any) {
    console.error(`[Firebase Login] [${traceId}] Transaction failed:`, err.message || err);
    try {
      await client.query('ROLLBACK');
      console.log(`[Firebase Login] [${traceId}] Transaction rolled back.`);
    } catch (rbErr) {}
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal database synchronization error during social login' });
  } finally {
    client.release();
  }
}

/**
 * Refresh Token Rotation (RTR) with replay attack / breach detection.
 */
export async function refresh(request: FastifyRequest, reply: FastifyReply) {
  const oldRefreshToken = request.cookies.refreshToken;

  if (!oldRefreshToken) {
    return reply.status(401).send({ error: 'Refresh token cookie is missing' });
  }

  const traceId = crypto.randomBytes(4).toString('hex');
  console.log(`[Token Refresh] [${traceId}] Rotating refresh token...`);

  // 1. Verify token signature and expiration
  let decoded: JWTPayload;
  try {
    decoded = verifyRefreshToken(oldRefreshToken);
  } catch (err) {
    // If expired, try to mark this specific token as revoked in DB
    console.warn(`[Token Refresh] [${traceId}] Refresh token verification failed: expired or invalid signature.`);
    const client = await pool.connect();
    try {
      await client.query('UPDATE refresh_tokens SET is_revoked = true WHERE token = $1', [oldRefreshToken]);
    } catch (dbErr) {}
    client.release();
    return reply.status(401).send({ error: 'Refresh token has expired' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`[Token Refresh] [${traceId}] Transaction started.`);

    // 2. Lock token record to prevent race conditions (FOR UPDATE)
    const dbTokenRes = await client.query('SELECT * FROM refresh_tokens WHERE token = $1 FOR UPDATE', [oldRefreshToken]);
    if (dbTokenRes.rows.length === 0) {
      console.warn(`[Token Refresh] [${traceId}] Refresh token not found in database.`);
      await client.query('ROLLBACK');
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }

    const dbToken = dbTokenRes.rows[0];

    // 3. Detect token reuse breach
    if (dbToken.is_used || dbToken.is_revoked) {
      console.error(`[Token Refresh] [${traceId}] Breach detected! Token already used/revoked. Revoking all family tokens for user: ${dbToken.user_id}`);
      // Revoke all tokens belonging to this user
      await client.query('UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1', [dbToken.user_id]);
      await client.query('COMMIT'); // Commit the revocation
      reply.clearCookie('refreshToken', { path: '/api/auth' });
      return reply.status(401).send({ error: 'Breach detected: Session terminated.' });
    }

    // 4. Mark old token as used
    console.log(`[Token Refresh] [${traceId}] Marking old token as used...`);
    await client.query('UPDATE refresh_tokens SET is_used = true WHERE id = $1', [dbToken.id]);

    // 5. Fetch user roles in case they changed
    const userRes = await client.query('SELECT roles FROM user_profiles WHERE id = $1', [dbToken.user_id]);
    const roles = userRes.rows.length > 0 ? parseRoles(userRes.rows[0].roles) : decoded.roles;

    // 6. Sign new Access + Refresh token pair
    const payload: JWTPayload = { userId: dbToken.user_id, email: decoded.email, roles };
    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    // 7. Store new refresh token in DB with reference to parent
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    console.log(`[Token Refresh] [${traceId}] Storing new refresh token...`);
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token, parent_token, expires_at) VALUES ($1, $2, $3, $4)`,
      [dbToken.user_id, newRefreshToken, oldRefreshToken, expiresAt]
    );

    await client.query('COMMIT');
    console.log(`[Token Refresh] [${traceId}] Token rotation committed successfully.`);

    reply.setCookie('refreshToken', newRefreshToken, getCookieOptions(request));

    return reply.send({ accessToken: newAccessToken });
  } catch (err: any) {
    console.error(`[Token Refresh] [${traceId}] Rotation failed:`, err.message || err);
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {}
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error during token refresh' });
  } finally {
    client.release();
  }
}

/**
 * Standard user log out. Revokes token.
 */
export async function logout(request: FastifyRequest, reply: FastifyReply) {
  const refreshToken = request.cookies.refreshToken;

  if (refreshToken) {
    console.log(`[Auth Logout] Revoking refresh token...`);
    const client = await pool.connect();
    try {
      await client.query('UPDATE refresh_tokens SET is_revoked = true WHERE token = $1', [refreshToken]);
    } catch (err: any) {
      console.error('[Auth Logout] Error revoking token:', err.message || err);
    } finally {
      client.release();
    }
  }

  reply.clearCookie('refreshToken', { path: '/api/auth' });
  return reply.send({ message: 'Logged out successfully' });
}

/**
 * Retrieves current active user profile.
 */
export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user || !user.userId) {
    return reply.status(401).send({ error: 'Unauthorized: User identity not found' });
  }

  const client = await pool.connect();
  try {
    const userRes = await client.query('SELECT * FROM user_profiles WHERE id = $1', [user.userId]);
    if (userRes.rows.length === 0) {
      return reply.status(404).send({ error: 'User profile not found' });
    }
    const profile = userRes.rows[0];
    const userRoles = parseRoles(profile.roles);
    return reply.send({
      id: profile.id,
      email: profile.email,
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone,
      photoUrl: profile.photo_url,
      roles: userRoles,
      fullInfo: profile.full_info,
    });
  } catch (err: any) {
    console.error(`[Auth getMe] Error fetching profile: ${err.message || err}`);
    return reply.status(500).send({ error: 'Failed to retrieve user profile' });
  } finally {
    client.release();
  }
}

/**
 * Updates phoneNumber for the authenticated user profile.
 */
export async function updatePhoneNumber(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }
  const { phone } = request.body as { phone: string };
  if (!phone) {
    return reply.status(400).send({ error: 'Phone number is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('UPDATE user_profiles SET phone = $1 WHERE id = $2', [phone, user.userId]);
    return reply.send({ success: true, message: 'Phone number updated successfully' });
  } catch (err: any) {
    console.error(`[Auth updatePhone] Error: ${err.message || err}`);
    return reply.status(500).send({ error: 'Failed to update phone number' });
  } finally {
    client.release();
  }
}
