import { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

/**
 * Hono-to-Fastify Adapter wrapper
 * Wraps Fastify handlers and hooks to be Hono-compatible middleware.
 */
export function wrap(fastifyHandler: any) {
  return async (c: Context, next: Next) => {
    // 1. Determine Content-Type and parse body accordingly
    let body: any = {};
    const contentType = c.req.header('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await c.req.json().catch(() => ({}));
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      body = await c.req.parseBody().catch(() => ({}));
    }

    // 2. Build mock Fastify request
    const request: any = {
      user: c.get('user'),
      body,
      params: c.req.param(),
      query: c.req.query(),
      headers: Object.fromEntries(c.req.raw.headers.entries()),
      cookies: getCookie(c),
      ip: c.req.header('x-forwarded-for') || c.req.raw.headers.get('cf-connecting-ip') || '127.0.0.1',
      log: {
        info: console.log,
        error: console.error,
        warn: console.warn,
      }
    };

    // 3. Build mock Fastify reply
    let responseStatus = 200;
    let responseHeaders: Record<string, string> = {};
    let responseBody: any = null;
    let sent = false;

    const reply: any = {
      status(code: number) {
        responseStatus = code;
        return this;
      },
      code(code: number) {
        responseStatus = code;
        return this;
      },
      header(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
        return this;
      },
      type(contentType: string) {
        responseHeaders['content-type'] = contentType;
        return this;
      },
      send(data: any) {
        responseBody = data;
        sent = true;
        return this;
      },
      setCookie(name: string, value: string, options: any = {}) {
        const honoOptions: any = {
          path: options.path,
          domain: options.domain,
          secure: options.secure,
          httpOnly: options.httpOnly,
          maxAge: options.maxAge,
          expires: options.expires,
          sameSite: options.sameSite ? (options.sameSite === true ? 'Lax' : options.sameSite) : undefined,
        };
        // Normalize sameSite casing for Hono
        if (honoOptions.sameSite) {
          const ss = String(honoOptions.sameSite).toLowerCase();
          if (ss === 'lax') honoOptions.sameSite = 'Lax';
          else if (ss === 'strict') honoOptions.sameSite = 'Strict';
          else if (ss === 'none') honoOptions.sameSite = 'None';
        }
        setCookie(c, name, value, honoOptions);
        return this;
      },
      clearCookie(name: string, options: any = {}) {
        deleteCookie(c, name, {
          path: options.path,
          domain: options.domain,
          secure: options.secure,
        });
        return this;
      }
    };

    // 4. Run the Fastify handler/hook
    await fastifyHandler(request, reply);

    // If the request was authenticated, propagate the user object back to the Hono context
    if (request.user) {
      c.set('user', request.user);
    }

    // 5. If response was sent, return it
    if (sent) {
      // Set response headers
      Object.entries(responseHeaders).forEach(([name, value]) => {
        c.header(name, value);
      });

      if (responseBody !== null && typeof responseBody === 'object') {
        return c.json(responseBody, responseStatus as any);
      } else {
        return c.text(responseBody || '', responseStatus as any);
      }
    }

    // 6. Otherwise (like middleware success), call next()
    await next();
  };
}
