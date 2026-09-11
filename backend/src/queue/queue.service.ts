import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';

const QUEUE_PREFIX = 'queue:';

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(QueueService.name);

  constructor(config: ConfigService) {
    const host = config.get<string>('REDIS_HOST', 'localhost');
    const port = Number(config.get<string>('REDIS_PORT', '6379'));
    this.redis = new Redis({ host, port, lazyConnect: true, maxRetriesPerRequest: 3 });
    this.redis.connect().catch((err: Error) => this.logger.warn('Redis queue connection failed: ' + err.message));
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }

  /**
   * Fase 9 - Cola virtual.
   * Un usuario se une a la cola de un producto. Idempotente: si ya está en
   * la cola, se actualiza su timestamp (vuelve al final). Retorna la posición
   * del usuario (1-based, 1 = siguiente en ser servido).
   */
  async join(productId: number, userId: number): Promise<number> {
    const key = QUEUE_PREFIX + productId;
    await this.redis.zadd(key, Date.now(), String(userId));
    const pos = await this.redis.zrank(key, String(userId));
    return (pos ?? 0) + 1;
  }

  /**
   * Retorna la posición del usuario en la cola (1-based) o 0 si no está.
   */
  async getPosition(productId: number, userId: number): Promise<number> {
    const pos = await this.redis.zrank(QUEUE_PREFIX + productId, String(userId));
    return pos !== null ? pos + 1 : 0;
  }

  /**
   * Retorna la longitud de la cola.
   */
  async size(productId: number): Promise<number> {
    return this.redis.zcard(QUEUE_PREFIX + productId);
  }

  /**
   * Saca al siguiente de la cola (FIFO por timestamp) y retorna su userId.
   * Si la cola está vacía, retorna null.
   */
  async dequeue(productId: number): Promise<{ userId: number; joinedAt: number } | null> {
    const key = QUEUE_PREFIX + productId;
    const entries = await this.redis.zrange(key, '0', '0', 'WITHSCORES');
    if (entries.length < 2) return null;

    const userId = Number(entries[0]);
    const joinedAt = Number(entries[1]);

    const removed = await this.redis.zrem(key, entries[0]);
    if (removed === 0) return null;

    return { userId, joinedAt };
  }

  /**
   * Un usuario abandona la cola.
   */
  async leave(productId: number, userId: number): Promise<boolean> {
    const removed = await this.redis.zrem(QUEUE_PREFIX + productId, String(userId));
    return removed > 0;
  }

  /**
   * Limpia la cola de un producto (para tests o admin reset).
   */
  async flush(productId: number): Promise<void> {
    await this.redis.del(QUEUE_PREFIX + productId);
  }
}