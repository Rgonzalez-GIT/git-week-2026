import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto, RefreshDto, RegisterDto, UpdateProfileDto } from './auth.dto.js';
import { AuthTokenPayload } from './jwt-auth.guard.js';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: {
    id: number;
    email: string;
    fullName: string;
    role: string;
  };
}

/**
 * Fase 12 - Autenticación JWT + refresh tokens (rotativos) + lockout.
 * Passwords con bcrypt; nunca en texto plano. Los tokens opacos (refresh)
 * se guardan hasheados en DB y se rotan en cada refresco.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');
  private readonly accessTtl: number;
  private readonly refreshTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {
    this.accessTtl = Number(this.config.get<string>('JWT_ACCESS_TTL', '900'));
    this.refreshTtl = Number(this.config.get<string>('JWT_REFRESH_TTL', '604800'));
  }

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('El correo ya está registrado');
    }
    const customerRole = await this.prisma.role.findUnique({ where: { code: 'CUSTOMER' } });

    const user = await this.prisma.user.create({
      data: {
        email,
        fullName: dto.fullName.trim(),
        passwordHash: await bcrypt.hash(dto.password, 12),
        roleId: customerRole?.id ?? 1,
      },
      include: { role: true },
    });

    this.logger.log(`Registro exitoso: ${user.email}`);
    return this.buildAuthResponse(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: true },
    });

    const now = new Date();
    if (!user) {
      await this.simulateHash(dto.password);
      throw new UnauthorizedException('Credenciales inválidas');
    }
    if (user.lockoutUntil && user.lockoutUntil > now) {
      throw new HttpException('Cuenta temporalmente bloqueada, intenta más tarde', HttpStatus.TOO_MANY_REQUESTS);
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.registerFailedAttempt(user.id);
      throw new UnauthorizedException('Credenciales inválidas');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockoutUntil: null },
    });

    this.logger.log(`Login exitoso: ${user.email}`);
    return this.buildAuthResponse(user as typeof user & { role: { code: string } });
  }

  async refresh(dto: RefreshDto): Promise<AuthResponse> {
    let payload: AuthTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AuthTokenPayload>(dto.refreshToken, {
        secret: this.refreshSecret(),
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido o expirado');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token incorrecto para refresco');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true },
    });
    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Sesión no activa');
    }
    const storedValid =
      user.refreshTokenHash === this.hashRefreshToken(dto.refreshToken);
    if (!storedValid) {
      throw new UnauthorizedException('Refresh token no coincide');
    }
    const now = new Date();
    if (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt < now) {
      throw new UnauthorizedException('Sesión expirada');
    }

    this.logger.log(`Refresh exitoso: ${user.email}`);
    return this.buildAuthResponse(user);
  }

  async logout(userId: number): Promise<{ ok: true }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
    });
    return { ok: true };
  }

  async me(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
      omit: { passwordHash: true, refreshTokenHash: true },
    });
    if (!user) throw new UnauthorizedException('Usuario no encontrado');
    return user;
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.password ? { passwordHash: await bcrypt.hash(dto.password, 12) } : {}),
      },
      include: { role: true },
      omit: { passwordHash: true, refreshTokenHash: true },
    });
    return user;
  }

  // ===== helpers =====

  private async buildAuthResponse(user: {
    id: number;
    email: string;
    fullName: string;
    role: { code: string };
  }): Promise<AuthResponse> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, fullName: user.fullName, role: user.role.code, type: 'access', jti: randomUUID() },
      { secret: this.accessSecret(), expiresIn: this.accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role.code, type: 'refresh', jti: randomUUID() },
      { secret: this.refreshSecret(), expiresIn: this.refreshTtl },
    );
    const refreshHash = this.hashRefreshToken(refreshToken);
    const refreshTokenExpiresAt = new Date(Date.now() + this.refreshTtl * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenHash: refreshHash, refreshTokenExpiresAt },
    });

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role.code },
    };
  }

  private async registerFailedAttempt(userId: number): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    const next = user.failedLogins + 1;
    if (next >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { failedLogins: 0, lockoutUntil: new Date(Date.now() + LOCKOUT_MS) },
      });
      this.logger.warn(`Lockout por intentos fallidos: ${user.email}`);
    } else {
      await this.prisma.user.update({ where: { id: userId }, data: { failedLogins: next } });
    }
  }

  /** Coste falso para no filtrar qué correos existen (timing). */
  private async simulateHash(_password: string): Promise<void> {
    await bcrypt.hash(randomUUID(), 10);
  }

  /** Hash SHA-256 del refresh token para no guardar tokens opacos en crudo. */
  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private accessSecret(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev_access_secret_change_me';
  }

  private refreshSecret(): string {
    return this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev_refresh_secret_change_me';
  }
}