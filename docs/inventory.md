# Inventario — Consistencia bajo alta concurrencia

**Regla de oro:** NUNCA `SELECT stock → validar en app → UPDATE stock`.

Todo movimiento de stock es un **UPDATE atómico con guarda en el WHERE**, contando filas afectadas. PostgreSQL es la única fuente de verdad; Redis no administra inventario (solo colas/caché).

## Operaciones

`InventoryService` (`backend/src/inventory/inventory.service.ts`) — todas aceptan un `tx` opcional para ejecutarse dentro de la misma transacción que su caso de uso:

| Operación | SQL (esencial) | Éxito = 1 fila afectada |
|---|---|---|
| `reserve(qty)` | `UPDATE inventory SET reserved+=q, available-=q, version=v+1 WHERE product_id=? AND available >= q` | false si stock insuficiente |
| `release(qty)` | `UPDATE inventory SET reserved-=q, available+=q, version=v+1 WHERE product_id=? AND reserved >= q` | idempotente; false si ya liberado |
| `sell(qty)` | `UPDATE inventory SET sold+=q, reserved-=q, version=v+1 WHERE product_id=? AND reserved >= q` | convierte reserva en venta |
| `restock(qty)` | `UPDATE inventory SET initial+=q, available+=q, version=v+1` | reposición admin |
| `reconcile()` | `SET available = initial - reserved - sold` | auditoría/corrección |

## Defensa en profundidad

1. **Guarda atómica** en cada UPDATE (resuelve la race condition en el servidor de DB).
2. **CHECK constraints** en la migración `0001_init` (bloquean estados imposibles aunque falle la app):
   - `reserved_stock + sold_stock <= initial_stock`
   - `reserved_stock >= 0`, `sold_stock >= 0`, `available_stock >= 0`
3. **Columna `version`** para optimistic locking a nivel de servicio (detección de conflictos de escritura).
4. **Transacciones interactivas** (`prisma.$transaction(async tx => …)`) que acoplan reserva ↔ orden ↔ pago.

## Escenario de referencia

Stock = 500. A pide 400, B pide 200. Solo un UPDATE de A (o B) pasa la guarda; el otro recibe `success: false` y NO se decrementa nada extra. Nunca vende sobre existencias.

## Fase 4 — Reservas temporales

`ReservationService` (`backend/src/reservations/reservation.service.ts`) orquesta el ciclo de vida de `inventory_reservations` junto con las mutaciones atómicas de `InventoryService`:

| Operación | Comportamiento | Idempotencia |
|---|---|---|
| `create(userId, productId, qty)` | Congela stock (`reserve`) y crea la fila `ACTIVE` con `expiresAt = now + TTL`, todo en la misma transacción | — |
| `cancel(publicId)` | `ACTIVE -> CANCELLED` + `releasedAt` y libera stock (UPDATE con guarda) | Segunda llamada => `ok: false`, no libera doble |
| `convert(publicId)` | `ACTIVE -> CONVERTED` y desplaza `reserved -> sold` (pago confirmado) | Ya `CONVERTED` => `true`; otro estado => `false` |
| `expireSweep(now)` | Expira las `ACTIVE` con `expiresAt <= now`: `-> EXPIRED` + `releasedAt` y libera stock | Sweep concurrente: el primero gana la guarda, el segundo libera 0 |

- La creación nunca hace `SELECT stock → validar -> INSERT`; la guarda `available >= qty` es la que decide dentro de la transacción (misma defensa que Fase 3).
- El TTL se configura con `RESERVATION_TTL_MINUTES` (default 10).
- Endpoints HTTP: `GET /reservations/:publicId` (consulta) y `POST /reservations/sweep` (limpieza). La creación/cancelación ocurren en transacciones del dominio (checkout/pagos), no se exponen sin autenticación.

## Verificación

Test de integración `backend/test/reservations.int-spec.ts`:

- crear congela stock y registra `ACTIVE` con expiración futura;
- reservar sobre el stock lanza `ConflictException` sin congelar nada;
- cancelar libera stock y una segunda cancelación no libera doble;
- convertir desplaza `reserved -> sold` y es idempotente;
- sweep expira vencidas, libera y el segundo sweep expira 0.

Además `backend/test/inventory.concurrency.int-spec.ts`:

- stock = 10 → **100 reservas concurrentes** ⇒ éxito = 10, nunca > 10.
- reservas parciales: A(4) ok, B(2) falla.
- `release` doble: segunda liberación falla (idempotencia).

Se ejecuta solo cuando hay PostgreSQL activo (`docker compose up -d`); sin DB, el archivo se omite (skip).