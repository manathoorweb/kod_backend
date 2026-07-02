import { FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../config/db';
import { signAccessToken, signRefreshToken, verifyRefreshToken, JWTPayload } from '../config/jwt';
import admin from '../config/firebase';

export function parseRoles(roles: any): string[] {
  if (!roles) return [];
  if (Array.isArray(roles)) return roles;
  if (typeof roles === 'string') {
    return roles.replace(/[{}]/g, '').split(',').map((s: string) => s.trim()).filter(Boolean);
  }
  return [];
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
}

/**
 * Controller handling user authentication (Registration, Password Login, Firebase social login, Token rotation, Logout)
 */
export async function register(request: FastifyRequest, reply: FastifyReply) {
  const { email, password, firstName, lastName, phone, dateOfBirth, gender, country, city } = request.body as RegisterBody;

  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }

  try {
    // Check if user already exists
    const userCheck = await pool.query('SELECT id FROM user_profiles WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return reply.status(409).send({ error: 'A user with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = crypto.randomUUID(); // Generate internal UID for password-based users

    // Insert user profile
    await pool.query(
      `INSERT INTO user_profiles (id, email, password_hash, first_name, last_name, phone, date_of_birth, gender, country, city)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [userId, email, passwordHash, firstName, lastName || null, phone || null, dateOfBirth || null, gender || null, country || null, city || null]
    );

    const payload: JWTPayload = { userId, email, roles: ['dancer'] };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // Save refresh token in database
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [userId, refreshToken, expiresAt]
    );

    // Set HTTP-only Cookie
    reply.setCookie('refreshToken', refreshToken, {
      path: '/api/auth',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });

    return reply.status(201).send({
      message: 'User registered successfully',
      accessToken,
      user: { id: userId, email, firstName, roles: ['dancer'] }
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error during registration' });
  }
}

export async function login(request: FastifyRequest, reply: FastifyReply) {
  const { email, password } = request.body as LoginBody;

  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }

  try {
    const userRes = await pool.query('SELECT * FROM user_profiles WHERE email = $1', [email]);
    if (userRes.rows.length === 0) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const user = userRes.rows[0];
    if (!user.password_hash) {
      return reply.status(400).send({ error: 'This account uses social sign-in. Please log in with Google.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const userRoles = parseRoles(user.roles);
    const payload: JWTPayload = { userId: user.id, email: user.email, roles: userRoles };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );

    reply.setCookie('refreshToken', refreshToken, {
      path: '/api/auth',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60,
    });

    return reply.send({
      accessToken,
      user: { id: user.id, email: user.email, firstName: user.first_name, roles: userRoles }
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error during login' });
  }
}

export async function firebaseLogin(request: FastifyRequest, reply: FastifyReply) {
  const { idToken } = request.body as FirebaseLoginBody;

  if (!idToken) {
    return reply.status(400).send({ error: 'Firebase ID Token is required' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name } = decodedToken;

    if (!email) {
      return reply.status(400).send({ error: 'Firebase token is missing email profile scope' });
    }

    // Sync or create user profile
    const userRes = await pool.query('SELECT * FROM user_profiles WHERE id = $1', [uid]);
    let user;

    if (userRes.rows.length === 0) {
      const splitName = name ? name.split(' ') : ['GoogleUser', ''];
      const firstName = splitName[0];
      const lastName = splitName.slice(1).join(' ') || null;

      const newUserRes = await pool.query(
        `INSERT INTO user_profiles (id, email, first_name, last_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [uid, email, firstName, lastName]
      );
      user = newUserRes.rows[0];
    } else {
      user = userRes.rows[0];
    }

    const userRoles = parseRoles(user.roles);
    const payload: JWTPayload = { userId: user.id, email: user.email, roles: userRoles };
    const accessToken = signAccessToken(payload);
    const refreshToken = signRefreshToken(payload);

    // Save refresh token
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshToken, expiresAt]
    );

    reply.setCookie('refreshToken', refreshToken, {
      path: '/api/auth',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60,
    });

    return reply.send({
      accessToken,
      user: { id: user.id, email: user.email, firstName: user.first_name, roles: userRoles }
    });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(401).send({ error: 'Invalid Firebase ID Token configuration' });
  }
}

/**
 * Refresh Token Rotation (RTR)
 */
export async function refresh(request: FastifyRequest, reply: FastifyReply) {
  const oldRefreshToken = request.cookies.refreshToken;

  if (!oldRefreshToken) {
    return reply.status(401).send({ error: 'Refresh token cookie is missing' });
  }

  try {
    // 1. Verify token signature and expiration
    let decoded: JWTPayload;
    try {
      decoded = verifyRefreshToken(oldRefreshToken);
    } catch (err) {
      // Invalidate token in DB if it's expired/invalid but exists
      await pool.query('UPDATE refresh_tokens SET is_revoked = true WHERE token = $1', [oldRefreshToken]);
      return reply.status(401).send({ error: 'Refresh token has expired' });
    }

    // 2. Lookup token in DB
    const dbTokenRes = await pool.query('SELECT * FROM refresh_tokens WHERE token = $1', [oldRefreshToken]);
    if (dbTokenRes.rows.length === 0) {
      return reply.status(401).send({ error: 'Invalid refresh token' });
    }

    const dbToken = dbTokenRes.rows[0];

    // 3. Detect token reuse breach
    if (dbToken.is_used || dbToken.is_revoked) {
      // Replay attack! Revoke all tokens belonging to the user family
      await pool.query('UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1', [dbToken.user_id]);
      reply.clearCookie('refreshToken', { path: '/api/auth' });
      return reply.status(401).send({ error: 'Breach detected: Refresh token has already been used. Session terminated.' });
    }

    // 4. Mark old token as used
    await pool.query('UPDATE refresh_tokens SET is_used = true WHERE id = $1', [dbToken.id]);

    // 5. Fetch user roles in case they changed
    const userRes = await pool.query('SELECT roles FROM user_profiles WHERE id = $1', [dbToken.user_id]);
    const roles = userRes.rows.length > 0 ? userRes.rows[0].roles : decoded.roles;

    // 6. Sign new Access + Refresh token pair
    const payload: JWTPayload = { userId: dbToken.user_id, email: decoded.email, roles };
    const newAccessToken = signAccessToken(payload);
    const newRefreshToken = signRefreshToken(payload);

    // 7. Store new refresh token in DB with reference to parent
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token, parent_token, expires_at) VALUES ($1, $2, $3, $4)`,
      [dbToken.user_id, newRefreshToken, oldRefreshToken, expiresAt]
    );

    // 8. Set new cookie
    reply.setCookie('refreshToken', newRefreshToken, {
      path: '/api/auth',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60,
    });

    return reply.send({ accessToken: newAccessToken });
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Internal server error during token refresh' });
  }
}

export async function logout(request: FastifyRequest, reply: FastifyReply) {
  const refreshToken = request.cookies.refreshToken;

  if (refreshToken) {
    try {
      // Mark token as revoked in DB
      await pool.query('UPDATE refresh_tokens SET is_revoked = true WHERE token = $1', [refreshToken]);
    } catch (err) {
      request.log.error(err);
    }
  }

  reply.clearCookie('refreshToken', { path: '/api/auth' });
  return reply.send({ message: 'Logged out successfully' });
}

export async function getMe(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user;
  if (!user) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  try {
    const userRes = await pool.query('SELECT * FROM user_profiles WHERE id = $1', [user.userId]);
    if (userRes.rows.length === 0) {
      return reply.status(404).send({ error: 'User profile not found' });
    }
    const profile = userRes.rows[0];
    profile.roles = parseRoles(profile.roles);
    return reply.send(profile);
  } catch (err: any) {
    request.log.error(err);
    return reply.status(500).send({ error: 'Failed to retrieve user profile' });
  }
}
