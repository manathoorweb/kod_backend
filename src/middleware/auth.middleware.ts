import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, JWTPayload } from '../config/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

/**
 * Fastify preValidation hook to authenticate JWT Access Tokens.
 * Includes request auditing (IP and User-Agent logging) for troubleshooting.
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const ip = request.ip;
  const userAgent = request.headers['user-agent'] || 'unknown';

  try {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      console.warn(`[Auth Middleware] Missing Authorization header from IP: ${ip}, User-Agent: ${userAgent}`);
      return reply.status(401).send({ error: 'Missing Authorization header' });
    }

    if (!authHeader.startsWith('Bearer ')) {
      console.warn(`[Auth Middleware] Malformed Authorization header format from IP: ${ip}`);
      return reply.status(401).send({ error: 'Malformed Authorization header. Format must be: Bearer <token>' });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      console.warn(`[Auth Middleware] Empty token from IP: ${ip}`);
      return reply.status(401).send({ error: 'Token is empty' });
    }

    const decoded = verifyAccessToken(token);
    request.user = decoded;
    
    console.log(`[Auth Middleware] Authenticated user ${decoded.userId} (${decoded.email}) from IP: ${ip}`);
  } catch (err: any) {
    console.error(`[Auth Middleware] Authentication failed from IP: ${ip}. Error: ${err.message || err}`);
    return reply.status(401).send({ error: err.message || 'Unauthorized access' });
  }
}

/**
 * Role authorization hook builder
 */
export function requireRoles(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      console.warn(`[Auth Middleware] requireRoles called but request.user is undefined. IP: ${request.ip}`);
      return reply.status(401).send({ error: 'Unauthorized: Authentication required' });
    }
    
    const hasRole = request.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      console.warn(`[Auth Middleware] User ${request.user.userId} forbidden. Has roles: [${request.user.roles.join(', ')}]. Required one of: [${allowedRoles.join(', ')}]. IP: ${request.ip}`);
      return reply.status(403).send({ error: 'Forbidden: Insufficient privileges' });
    }
  };
}
