import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, JWTPayload } from '../config/jwt';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JWTPayload;
  }
}

/**
 * Fastify preValidation hook to authenticate JWT Access Tokens
 */
export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or malformed Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);
    request.user = decoded;
  } catch (err: any) {
    return reply.status(401).send({ error: err.message || 'Unauthorized access' });
  }
}

/**
 * Role authorization hook builder
 */
export function requireRoles(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    
    const hasRole = request.user.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      return reply.status(403).send({ error: 'Forbidden: Insufficient privileges' });
    }
  };
}
