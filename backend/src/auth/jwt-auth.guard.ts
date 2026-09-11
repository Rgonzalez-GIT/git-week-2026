import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

export interface AuthTokenPayload {
  sub: number;
  email: string;
  fullName: string;
  role: string;
  type?: 'access' | 'refresh';
}

export const REQUEST_USER_KEY = 'user';

/**
 * Fase 12 - Guard de autenticación por JWT (sin passport).
 * Verifica manualmente el token Bearer y adjunta el payload a req.user.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { [REQUEST_USER_KEY]?: AuthTokenPayload }>();
    const token = this.extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('Token de acceso requerido');
    }
    try {
      const payload = await this.jwtService.verifyAsync<AuthTokenPayload>(token, {
        secret: this.accessSecret(request),
      });
      if (payload.type === 'refresh') {
        throw new UnauthorizedException('Token de acceso inválido');
      }
      request[REQUEST_USER_KEY] = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token de acceso inválido o expirado');
    }
  }

  private extractBearer(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header) return undefined;
    const [scheme, token] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
  }

  // El secret se antepone como cabecera de configuración puesto que JwtModule
  // es global y no queremos inyectar ConfigService aquí.
  private accessSecret(_request: Request): string {
    return process.env.JWT_ACCESS_SECRET ?? 'dev_access_secret_change_me';
  }
}