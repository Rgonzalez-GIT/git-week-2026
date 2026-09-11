# Git Week 2026 — E-commerce de eventos

Plataforma de venta de entradas (planes General / Professional / Premium) para el evento **GIT Week 2026**, construida como monorepo con backend NestJS + Prisma 7 + PostgreSQL, frontend estático (nginx), Redis para cola virtual y despliegue por `docker compose`.

## Stack

| Capa | Tecnología |
| --- | --- |
| Backend | NestJS 12 (TypeScript, nodenext) |
| ORM / DB | Prisma 7 (`@prisma/adapter-pg`) + PostgreSQL 16 |
| Cache / Cola | Redis 7 (ioredis) |
| Frontend | `index.html` + nginx 1.27 |
| Auth | JWT (access + refresh rotativo SHA-256), bcrypt, RBAC |
| Seguridad | helmet, throttling (`@nestjs/throttler`), webhook HMAC-SHA256 |
| Docs API | Swagger en `/docs` |
| QR | `qrcode` (cupón físico con QR al confirmar pago) |
| Calidad | vitest (unit/int/e2e), oxlint, GitHub Actions |

## Arquitectura (dominio)

- **Inventario atómico**: movimientos de stock mediante `UPDATE` con guarda (`availableStock >= quantity`) sobre PostgreSQL; disponible/reservado/vendido consistentes bajo concurrencia.
- **Reservas temporales**: TTL (`RESERVATION_TTL_MINUTES`, default 10 min) con sweep de expiración y liberación de stock.
- **Checkout / Órdenes**: transaccional e idempotente (`Idempotency-Key`); total con descuento dinámico.
- **Pagos**: abstracción por provider (sandbox) + webhook firmado con HMAC-SHA256 (`WEBHOOK_SECRET`), idempotente, body crudo (`rawBody: true`).
- **Cupones físicos**: `CouponService` (URPxGIT/UTPxGIT/UNABxGIT, S/5 off) y `CouponRewardService` emite `PROMO-2026-XXXXXXXX` + **QR** al confirmar pago.
- **Redemption anti doble canje**: `POST /coupons/redeem` usa UPDATE atómico con guarda `status=AVAILABLE` y auditoría `REDEEMED/CONFLICT` en `coupon_redemptions`.
- **Cola virtual**: Redis SORTED SET con posición, abandono y dequeue (admin).
- **Admin**: panel REST solo rol `ADMIN` (stats, users, orders, promotions, PATCH productos/promociones).
- **Observabilidad**: `/health` (liveness), `/health/ready` (readiness con chequeo DB), request-id y logging de request/response.

## Quickstart

```bash
cp .env.example .env          # ajustar credenciales
docker compose up -d --build  # postgres + redis + backend + frontend
```

- API: http://localhost:3001 · Swagger: http://localhost:3001/docs · Frontend: http://localhost:8080
- Credenciales demo (seed): `admin@gitweek.local` / `ChangeMe123!`

Primeros pasos en un entorno ya iniciado:

```bash
docker compose up -d
cd backend
npm ci --legacy-peer-deps
npx prisma migrate deploy --config prisma7.config.ts
npx tsx prisma/seed.ts
```

## Endpoints principales

Para uso autenticado: header `Authorization: Bearer <accessToken>`.

| Método | Ruta | Acceso |
| --- | --- | --- |
| POST | `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` | público (rate-limited) |
| GET | `/products`, `/products/:slug` | público |
| GET | `/coupons/:publicId` (+ `/qr`), `/coupons/mine` | público (mine: JWT) |
| POST | `/coupons/redeem` | JWT |
| GET/POST/PATCH/DELETE | `/cart`, `/cart/items/:productId` | JWT o sessionKey |
| POST | `/reservations` | JWT |
| POST | `/checkout`, GET `/checkout/:publicId` | JWT |
| POST | `/orders/:publicId/coupon`, GET `/orders/mine` | JWT |
| POST | `/payments/create` | JWT |
| POST | `/payments/webhook` | HMAC-SHA256 |
| GET/POST/DELETE | `/queue/join`, `/queue/:productId`, `/queue/dequeue`, `/queue/:productId/flush` | JWT (dequeue/flush: ADMIN) |
| GET | `/admin/stats`, `/admin/users`, `/admin/orders`, `/admin/promotions` | ADMIN |
| PATCH | `/admin/products/:id`, `/admin/promotions/:id` | ADMIN |
| GET | `/health`, `/health/ready`, (`/docs`) | público |

Flujo de compra sin login (demo): el frontend usa `/api/demo/*` (reservar → orden → cupón → pagar → confirmar) con `localStorage gw-session`.

## Testing

```bash
cd backend
npm test          # unit + integración (56 tests, incl. concurrencia 10/1000)
npm run test:e2e  # e2e (22 tests; necesita postgres + redis activos)
npm run build     # build NestJS
npm run lint      # oxlint
```

El CI (`.github/workflows/ci.yml`) levanta PostgreSQL y Redis como servicios y ejecuta migraciones + seed + build + lint + ambos test suites. Imagen del backend se construye en un job aparte.

## Decisiones de APIs externas

Ver [`API_DECISIONS.md`](./API_DECISIONS.md): Culqi (pagos, recomendado), Resend (email), Infobip (SMS), Cloudinary (imágenes), Sentry (errores).

## Documentación técnica

- [`docs/database.md`](./docs/database.md) — modelo de datos
- [`docs/inventory.md`](./docs/inventory.md) — inventario atómico
- [`NOTA_REINICIO.md`](./NOTA_REINICIO.md) — estado del proceso y cómo retomarlo

## Roadmap (19 fases)

Auditoría → arquitectura → modelo de datos → inventario → reservas → checkout/órdenes → pagos → cupones físicos+QR → redemption anti doble canje → cola virtual → carrito → APIs → autenticación → seguridad → admin → observabilidad → testing → docker → CI/CD → documentación.