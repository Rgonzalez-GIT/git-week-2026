import { ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { InventoryReservation } from '../generated/prisma/client.js';
import { InventoryService, TxClient } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateReservationInput {
  userId: number;
  productId: number;
  quantity: number;
}

export interface CancelReservationResult {
  ok: boolean;
}

/**
 * Fase 4 - Reservas temporales.
 *
 * Una reserva congela stock por un TTL (RESERVATION_TTL_MINUTES).
 * Reservar stock y registrar la reserva son atomicos dentro de la misma
 * transaccion interactiva. Todo movimiento pasa por InventoryService
 * (UPDATE con guarda; PostgreSQL es la fuente de verdad).
 */
@Injectable()
export class ReservationService implements OnModuleInit, OnModuleDestroy {
  private readonly ttlMinutes: number;
  private readonly logger = new Logger(ReservationService.name);
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    config: ConfigService,
  ) {
    const ttl = Number(config.get<string>('RESERVATION_TTL_MINUTES', '6'));
    this.ttlMinutes = Number.isFinite(ttl) && ttl > 0 ? ttl : 6;
  }

  /**
   * Fase 16 - Autosweep: cada SWEEP_INTERVAL_MS (default 30s) expira reservas
   * vencidas y libera su stock. 0 desactiva el scheduler (caso de tests).
   */
  onModuleInit() {
    const intervalMs = Number(process.env.SWEEP_INTERVAL_MS ?? '30000');
    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      this.sweepTimer = setInterval(() => {
        this.expireSweep()
          .then((n) => {
            if (n > 0) this.logger.log(`Sweep: ${n} reserva(s) expirada(s), stock liberado`);
          })
          .catch((err: Error) => this.logger.warn(`Sweep fallo: ${err.message}`));
      }, intervalMs);
      this.sweepTimer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  async findByPublicId(publicId: string): Promise<InventoryReservation> {
    const reservation = await this.prisma.inventoryReservation.findUnique({ where: { publicId } });
    if (!reservation) {
      throw new NotFoundException(`Reserva ${publicId} no encontrada`);
    }
    return reservation;
  }

  /** Crea una reserva temporal: congela stock y registra la fila en la misma transaccion. */
  async create(input: CreateReservationInput): Promise<InventoryReservation> {
    await this.inventory.find(input.productId);
    const expiresAt = new Date(Date.now() + this.ttlMinutes * 60_000);

    return this.prisma.$transaction(async (tx) => {
      const reserved = await this.inventory.reserve(input.productId, input.quantity, tx);
      if (!reserved.success) {
        throw new ConflictException(`Stock insuficiente para el producto ${input.productId}`);
      }
      return tx.inventoryReservation.create({
        data: {
          publicId: randomUUID(),
          userId: input.userId,
          productId: input.productId,
          quantity: input.quantity,
          expiresAt,
        },
      });
    });
  }

  /** Cancela una reserva ACTIVE y libera su stock. Idempotente: no libera doble. */
  async cancel(publicId: string): Promise<CancelReservationResult> {
    const reservation = await this.findByPublicId(publicId);
    if (reservation.status !== 'ACTIVE') {
      return { ok: false };
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.inventoryReservation.updateMany({
        where: { publicId, status: 'ACTIVE' },
        data: { status: 'CANCELLED', releasedAt: new Date() },
      });
      if (claimed.count === 0) {
        return { ok: false };
      }
      const released = await this.inventory.release(reservation.productId, reservation.quantity, tx);
      if (!released.success) {
        throw new Error(`No se pudo liberar el stock de la reserva ${publicId}`);
      }
      return { ok: true };
    });
  }

  /**
   * Convierte una reserva ACTIVE en CONVERTED (venta consumida).
   * Se invoca con el pago de la orden confirmado; desplaza reserved -> sold.
   * Idempotente: si ya esta CONVERTED devuelve true; si no esta ACTIVE, false.
   */
  async convert(publicId: string, tx?: TxClient): Promise<boolean> {
    const client = tx ?? this.prisma;
    const reservation = await client.inventoryReservation.findUnique({ where: { publicId } });
    if (!reservation) {
      throw new NotFoundException(`Reserva ${publicId} no encontrada`);
    }
    if (reservation.status === 'CONVERTED') return true;
    if (reservation.status !== 'ACTIVE') return false;

    const doConvert = async (c: TxClient): Promise<boolean> => {
      const claimed = await c.inventoryReservation.updateMany({
        where: { publicId, status: 'ACTIVE' },
        data: { status: 'CONVERTED' },
      });
      if (claimed.count === 0) return false;
      const sold = await this.inventory.sell(reservation.productId, reservation.quantity, c);
      if (!sold.success) {
        throw new Error(`No se pudo vender el stock de la reserva ${publicId}`);
      }
      return true;
    };

    if (tx) return doConvert(tx);
    return this.prisma.$transaction((c) => doConvert(c));
  }

  /**
   * Expira reservas vencidas (ACTIVE con expiresAt <= now) y libera su stock.
   * Cada una se reclama con UPDATE con guarda dentro de su propia transaccion,
   * de modo que un sweep concurrente nunca libera doble. Retorna la cantidad.
   */
  async expireSweep(now: Date = new Date()): Promise<number> {
    const due = await this.prisma.inventoryReservation.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true },
    });

    let expired = 0;
    for (const r of due) {
      if (await this.expireOne(r.id, now)) expired += 1;
    }
    return expired;
  }

  private async expireOne(id: number, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservation.findUnique({ where: { id } });
      if (!reservation) return false;

      const claimed = await tx.inventoryReservation.updateMany({
        where: { id, status: 'ACTIVE' },
        data: { status: 'EXPIRED', releasedAt: now },
      });
      if (claimed.count === 0) return false;

      await this.inventory.release(reservation.productId, reservation.quantity, tx);
      return true;
    });
  }
}