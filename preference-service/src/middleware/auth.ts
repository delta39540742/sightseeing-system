import { Request, Response, NextFunction } from 'express';

/**
 * Middleware auth — Người 1 đã verify token ở API Gateway.
 * Request đến đây đã có header x-user-id chứa UUID của user.
 *
 * Nếu nhóm dùng JWT trực tiếp thay vì forward header,
 * đổi logic bên dưới để decode JWT và lấy sub/userId.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Người 1 forward userId qua header sau khi verify Firebase token
  const userId = req.headers['x-user-id'] as string | undefined;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized', message: 'Missing x-user-id header' });
    return;
  }

  // Validate UUID format đơn giản
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid user id format' });
    return;
  }

  // Gắn vào res.locals để dùng trong route handlers
  res.locals.userId = userId;
  next();
}
