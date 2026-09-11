import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ?? 'postgresql://gitweek:gitweek_dev@localhost:5432/gitweek?schema=public',
});
const prisma = new PrismaClient({ adapter });

// Dev-only. Nunca usar estas credenciales en producción.
const DEV_ADMIN_PASSWORD = 'ChangeMe123!';

async function main() {
  const roles = [
    { code: 'CUSTOMER', name: 'Cliente', description: 'Comprador del evento' },
    { code: 'ADMIN', name: 'Administrador', description: 'Acceso total al panel' },
    { code: 'STAFF', name: 'Staff', description: 'Soporte operativo del evento' },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: { code: role.code },
      update: { name: role.name, description: role.description },
      create: role,
    });
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  const customerRole = await prisma.role.findUniqueOrThrow({ where: { code: 'CUSTOMER' } });
  const staffRole = await prisma.role.findUniqueOrThrow({ where: { code: 'STAFF' } });

  await prisma.user.upsert({
    where: { email: 'admin@gitweek.local' },
    update: {},
    create: {
      email: 'admin@gitweek.local',
      fullName: 'Admin GIT Week',
      passwordHash: await bcrypt.hash(DEV_ADMIN_PASSWORD, 12),
      roleId: adminRole.id,
    },
  });

  const seedProducts = [
    {
      slug: 'general',
      name: 'Plan General',
      description: 'Acceso a ceremonias, feria empresarial y masterclass (ponencias)',
      priceCents: 3900,
      tier: 'GENERAL' as const,
      initialStock: 2000,
    },
    {
      slug: 'professional',
      name: 'Plan Professional',
      description: 'Todo lo del plan General, Kit Básico y taller de empleabilidad',
      priceCents: 6900,
      tier: 'PROFESSIONAL' as const,
      initialStock: 70,
    },
    {
      slug: 'executive',
      name: 'Plan Executive',
      description: 'Acceso completo, Kit Premium, visita técnica y networking preferencial',
      priceCents: 9900,
      tier: 'EXECUTIVE' as const,
      initialStock: 30,
    },
  ];

  for (const p of seedProducts) {
    const { initialStock, ...product } = p;
    const created = await prisma.product.upsert({
      where: { slug: p.slug },
      update: { name: p.name, description: p.description, priceCents: p.priceCents },
      create: product,
    });
    await prisma.inventory.upsert({
      where: { productId: created.id },
      update: {},
      create: {
        productId: created.id,
        initialStock,
        reservedStock: 0,
        soldStock: 0,
        availableStock: initialStock,
      },
    });
  }

  await prisma.user.upsert({
    where: { email: 'customer@gitweek.local' },
    update: {},
    create: {
      email: 'customer@gitweek.local',
      fullName: 'Cliente Demo',
      passwordHash: await bcrypt.hash(DEV_ADMIN_PASSWORD, 12),
      roleId: customerRole.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'staff@gitweek.local' },
    update: {},
    create: {
      email: 'staff@gitweek.local',
      fullName: 'Staff Demo',
      passwordHash: await bcrypt.hash(DEV_ADMIN_PASSWORD, 12),
      roleId: staffRole.id,
    },
  });

  console.log('Seed completado.');
  console.log(`Usuarios demo (contraseña ${DEV_ADMIN_PASSWORD} - SOLO desarrollo):`);
  console.log('  admin@gitweek.local (ADMIN)');
  console.log('  customer@gitweek.local (CUSTOMER)');
  console.log('  staff@gitweek.local (STAFF)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());