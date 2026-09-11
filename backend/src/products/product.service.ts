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
}

export interface CatalogStock {
  productId: number;
  availableStock: number;
  reservedStock: number;
  soldStock: number;
  initialStock: number;
}

/**
 * Fase 11 (parcial) - Catalogo público de la tienda.
 * Solo lectura: lista los productos ACTIVE con el stock disponible
 * (ya descontando reservas vigentes). El stock lo administra PostgreSQL.
 */
@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async listAvailable(): Promise<CatalogProduct[]> {
    const rows = await this.prisma.product.findMany({
      where: { status: ProductStatus.ACTIVE },
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