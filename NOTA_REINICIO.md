# Continuar el proceso APPGITWEEK

Abrir opencode dentro de esta carpeta y pegar:

```
Continúa el proceso de APPGITWEEK.md donde lo dejamos. Estado actual: Fases 0-8, 10, 11, 12, 13, 14, 15 y 16 ✅ (auth JWT, cupones+QR, redemption, APIs+Swagger, carrito landing, seguridad, admin, observabilidad, concurrencia), Fase 9 Cola virtual ✅ (Redis, polling REST + admin dequeue), Docker + e2e verificado ✅ en stack local. CI/CD creado (`.github/workflows/ci.yml`, sin correr aún). Pendientes: correr CI en GitHub, docs finales (README), commits. Verificar: npm test (56/56), npm run test:e2e (22/22), npm run build, npm run lint.
```

El plan original **sí existe**: `C:\Users\Raul\Desktop\APPGITWEEK.md` (19 fases). Orden del documento:
0 Auditoría · 1 Arquitectura · 2 Modelo de datos · 3 Inventario · 4 Reservas · 5 Checkout/Órdenes · 6 Pagos · 7 Cupones (cupón con QR al confirmar pago) · 8 Redemption (anti doble canje) · 9 Cola virtual · 10 Carrito · 11 APIs · 12 Autenticación · 13 Seguridad · 14 Admin · 15 Observabilidad · 16 Testing · 17 Docker · 18 CI/CD · 19 Documentación.

Estado actual (rama `feature/ecommerce-promotions`, HEAD `9be11a8`, nada committeado):

### Completadas
- **Fases 0-6**: auditoría, arquitectura, modelo de datos, inventario atómico, reservas temporales, órdenes (idempotencia `Idempotency-Key`), pagos (abstracción provider, webhook idempotente). Migración `0001_init` + seed.
- **Fase 10 (Carrito)**: `CartService` + `CartController` (sessionKey + userId) + DTOs. Tests OK.
- **Fase 7 completa (Cupón físico + QR)**: `CouponService` (URPxGIT/UTPxGIT/UNABxGIT, S/5 off) + `CouponRewardService` (emite `PROMO-2026-XXXXXXXX` + QR al confirmar pago) + `CouponRewardController`. Migraciones `0002-0003`. Tests OK.
- **Fase 8 (Redemption anti doble canje)**: `CouponRewardService.redeem()` transaccional con UPDATE atómico + guarda (status=AVAILABLE), audit `REDEEMED/CONFLICT`, test de concurrencia 10 simultáneos → exactamente 1 éxito. `POST /coupons/redeem` (JWT). Tests OK.
- **Fase 12 (Auth JWT)**: register/login/refresh/logout/me, refresh rotativo SHA-256, lockout tras 5 intentos, RBAC (CUSTOMER/ADMIN/STAFF). Migraciones `0004+0005`. AuthModule `@Global()`. Tests OK.
- **Fase 11 (APIs con auth + Swagger)**: reservas/checkout/payments (webhook HMAC-SHA256)/orders/cart autenticados; Swagger en `http://localhost:3001/docs`; `rawBody: true`; `WEBHOOK_SECRET` en env + compose.
- **Carrito en landing** (`index.html`): sección "Tienda" (catálogo + sidebar carrito) con `localStorage gw-session` y flujo `/api/demo/*` sin auth.
- **Fase 13 (Seguridad)**: `helmet` (CSP off, embebido para QR), `@nestjs/throttler` (global 60/min, auth 5/min, refresh 10/min, webhook `@SkipThrottle`), `src/security.ts` (`setupSecurity` reusable para tests). Tests e2e `security.e2e-spec.ts`. OK.
- **Fase 15 (Observabilidad)**: `GET /health` (liveness) + `GET /health/ready` (readiness `SELECT 1`, 503 si DB abajo), `src/observability.ts` (X-Request-Id + log method/path/status/duration), healthcheck de docker-compose → `/health/ready`. Tests `health.e2e-spec.ts`. OK.
- **Fase 14 (Admin)**: `src/admin/` con `AdminController` (`@Controller('admin')` + `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles('ADMIN')`): `GET /admin/stats`, `/admin/users`, `/admin/orders`, `/admin/promotions`, `PATCH /admin/products/:id`, `PATCH /admin/promotions/:id`. Login admin demo: `admin@gitweek.local` / `ChangeMe123!` (seed). Tests `admin.e2e-spec.ts`. OK.
- **Fase 9 (Cola virtual)**: `src/queue/` con Redis SORTED SET (ioredis). `POST /queue/join` (auth, idempotente, retorna posición), `GET /queue/:productId` (posición+size), `POST /queue/dequeue` (admin, FIFO), `DELETE /queue/:productId` (abandonar), `DELETE /queue/:productId/flush` (admin). Sin WebSocket (polling); si Redis no está, los tests se omiten con warning. Tests `queue.e2e-spec.ts`. OK.
- **Fase 16 (Testing concurrencia)**: `concurrency.int-spec.ts` — bursts 10/10, 10/50, 20/200 y **10/1000** requests simultáneos contra stock limitado (UPDATE con guarda `availableStock >= quantity`): exactamente el stock se reserva, sin sobreventa, inventario reconcilia tras cancelar todo. OK.
- **Fase 17 (Docker)**: backend rebuild + full stack (`docker compose up`) verificado en vivo: `/health/ready`, `/docs`, `/products`, login admin → `/admin/stats` (users=40, orders=27, products=65, promos=97), cola Redis join/status/leave OK.
- **Fase 18 (CI/CD)**: `.github/workflows/ci.yml` creado (jobs backend: postgres+redis services, npm ci, prisma generate → migrate deploy → seed, build, lint, test, test:e2e; job docker: build image). **Aún no ejecutado en GitHub.**
- **API_DECISIONS.md**: Culqi (pagos, recomendado), Resend (email), Infobip (SMS MVP), qrcode npm (ya integrado), Cloudinary (imágenes), Sentry (errores).

### Pendientes
- Correr CI/CD en GitHub y corregir si falla
- Documentación final (README)
- Commitear / actualizar rama
- (Opcional, si el plan lo pide) integrar WebSocket real en la cola virtual y mostrar posición en vivo en la landing

### Verificación estándar
```bash
npm test          # 56/56 tests (vitest, 10 archivos)
npm run test:e2e  # 22/22 tests (7 archivos, incluye cola Redis + admin)
npm run build     # NestJS build OK
npm run lint      # oxlint, 0 warnings
```

### Notas de entorno
- Comandos Prisma 7: `npx prisma <cmd> --config prisma7.config.ts`
- Migraciones siempre aditivas (nunca borrar tablas/datos)
- Test de integración requiere postgres activo (`docker compose up -d`); e2e de cola requiere Redis activo (se omite si no está)
- Prisma columnas en PostgreSQL usan **camelCase** (fullName, passwordHash, roleId, failedLogins, etc.)
- `TooManyRequestsException` NO existe en Nest 12 → usar `HttpException(msg, HttpStatus.TOO_MANY_REQUESTS)`
- Refresh tokens: NUNCA con bcrypt (trunca 76 bytes) → usar SHA-256 + `jti: randomUUID()`
- Imports de tipos con `import type` para `Request`/`Response` de Express (TS1272)
- Rutas Express: orden de controllers en `@Module` = orden de registro; `CouponRewardController` ANTES que `CouponController`
- `AuthModule` es `@Global()` — JwtService + JwtAuthGuard disponibles en todos los módulos
- `main.ts` usa `{ rawBody: true }` para HMAC sobre body crudo (webhook)
- Tests e2e crean su propia app (no pasan por `main.ts`): deben llamar `setupSecurity(app)` y `setupRequestLogging(app)` si verifican esos middleware
- ioredis: importar con `import { Redis } from 'ioredis'` (named export) — con `nodenext` el default export falla en TS
- Identidad git: Rgonzalez-GIT / raulogonzalezo@gmail.com
- Remotes: origin = fork personal, upstream = orlanduhni/git-week-2026