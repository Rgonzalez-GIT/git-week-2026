import 'dotenv/config';
import {
  ConflictException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';

/**
 * Fase 12 - Tests de integración de autenticación.
 * register/login/refresh/logout + lockout por intentos fallidos.
 */
const config = new ConfigService(process.env as Record<string, string>);
const prisma = new PrismaService(config);
const jwt = new JwtService();

let dbAvailable = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  console.warn('DB no disponible: omitiendo test de auth.');
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)('Auth (Fase 12)', () => {
  const auth = new AuthService(prisma, jwt, config);
  const emails: string[] = [];

  function randomEmail() {
    const email = `auth-${randomUUID()}@test.local`;
    emails.push(email);
    return email;
  }

  afterEach(async () => {
    if (emails.length) {
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      emails.length = 0;
    }
  });

  it('registra un usuario con rol CUSTOMER y devuelve tokens', async () => {
    const email = randomEmail();
    const res = await auth.register({ email, password: '12345678', fullName: 'Juan Pérez' });

    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toBeTruthy();
    expect(res.user.email).toBe(email);
    expect(res.user.role).toBe('CUSTOMER');

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).not.toBe('12345678');
  });

  it('rechaza un correo duplicado', async () => {
    const email = randomEmail();
    await auth.register({ email, password: '12345678', fullName: 'A' });
    await expect(
      auth.register({ email, password: '87654321', fullName: 'B' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('hace login con contraseña correcta', async () => {
    const email = randomEmail();
    const registered = await auth.register({ email, password: '12345678', fullName: 'A' });
    const res = await auth.login({ email, password: '12345678' });
    expect(res.accessToken).toBeTruthy();
    expect(registered.user.email).toBe(email);
  });

  it('bloquea tras 5 intentos fallidos de login', async () => {
    const email = randomEmail();
    await auth.register({ email, password: '12345678', fullName: 'A' });

    for (let i = 0; i < 5; i += 1) {
      await expect(auth.login({ email, password: 'incorrecta' })).rejects.toBeInstanceOf(UnauthorizedException);
    }
    await expect(auth.login({ email, password: '12345678' })).rejects.toBeInstanceOf(HttpException);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.lockoutUntil && user.lockoutUntil > new Date()).toBeTruthy();
  });

  it('rota el refresh token y rechaza reutilizar el anterior', async () => {
    const email = randomEmail();
    const first = await auth.register({ email, password: '12345678', fullName: 'A' });

    const second = await auth.refresh({ refreshToken: first.refreshToken });
    expect(second.refreshToken).not.toBe(first.refreshToken);

    await expect(auth.refresh({ refreshToken: first.refreshToken })).rejects.toBeInstanceOf(UnauthorizedException);
    const ok = await auth.refresh({ refreshToken: second.refreshToken });
    expect(ok.accessToken).toBeTruthy();
  });

  it('logout invalida la sesión', async () => {
    const email = randomEmail();
    const res = await auth.register({ email, password: '12345678', fullName: 'A' });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await auth.logout(user.id);
    await expect(auth.refresh({ refreshToken: res.refreshToken })).rejects.toBeInstanceOf(UnauthorizedException);
  });
});