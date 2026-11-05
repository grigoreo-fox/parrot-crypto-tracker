import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function bearerAuth(token: string): RequestHandler {
  const tokenHash = createHash('sha256').update(token).digest();
  return (request, response, next) => {
    const match = /^Bearer ([^\s]+)$/i.exec(request.get('authorization') ?? '');
    const supplied = createHash('sha256').update(match?.[1] ?? '').digest();
    if (!match || !timingSafeEqual(tokenHash, supplied)) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
}
