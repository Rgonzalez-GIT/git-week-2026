import { Injectable } from '@nestjs/common';
import { ProductStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CatalogProduct {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  availableStock: number;
  initialStock: number;
}

export interface CatalogStock {
  productId: number;
  availableStock: number;
  reservedStock: number;
  soldStock: number;
  initialStock: number;
}

/** Tipos de entrada que ofrece la tienda (según el seed). */
const TIENDA_SLUGS = ['general', 'professional', 'executive'];

/**
 * Fase 11 (parcial) - Catalogo público de la tienda.
 * Solo lectura: lista los tipos de entrada ACTIVE con su stock disponible
 * (ya descontando reservas vigentes). El stock lo administra PostgreSQL.
 * Solo se exponen los planes del seed (nunca productos de tests/demo).
 */
@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailable(): Promise<CatalogProduct[]> {
    const rows = await this.prisma.product.findMany({
      where: { status: ProductStatus.ACTIVE, slug: { in: TIENDA_SLUGS } },
      include: { inventory: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      availableStock: p.inventory?.availableStock ?? 0,
      initialStock: p.inventory?.initialStock ?? 0,
    }));
  }

  async stock(productId: number): Promise<CatalogStock & { priceCents: number; name: string }> {
    const inventory = await this.prisma.inventory.findUnique({ where: { productId } });
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    return {
      productId,
      name: product?.name ?? `Producto ${productId}`,
      priceCents: product?.priceCents ?? 0,
      availableStock: inventory?.availableStock ?? 0,
      reservedStock: inventory?.reservedStock ?? 0,
      soldStock: inventory?.soldStock ?? 0,
      initialStock: inventory?.initialStock ?? 0,
    };
  }
}