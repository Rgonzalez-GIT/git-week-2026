import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { REQUEST_USER_KEY } from './jwt-auth.guard.js';

/** Extrae el payload del usuario autenticado desde req.user. */
export const CurrentUser = createParamDecorator(
  (field: keyof import('./jwt-auth.guard.js').AuthTokenPayload | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{ [REQUEST_USER_KEY]?: unknown }>();
    const user = request[REQUEST_USER_KEY];
    return field && user ? (user as Record<string, unknown>)[field] : user;
  },
);