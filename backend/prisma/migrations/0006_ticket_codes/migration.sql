-- AlterTable: datos del comprador / líder de grupo
ALTER TABLE "orders"
  ADD COLUMN "buyerFirstName" TEXT,
  ADD COLUMN "buyerLastName" TEXT,
  ADD COLUMN "buyerEmail" TEXT,
  ADD COLUMN "buyerPhone" TEXT,
  ADD COLUMN "buyerDocType" TEXT DEFAULT 'DNI',
  ADD COLUMN "buyerDocNumber" TEXT;

-- CreateTable: código único por entrada emitido al confirmar el pago
CREATE TYPE "TicketStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'REDEEMED', 'EXPIRED');

CREATE TABLE "ticket_codes" (
  "id" SERIAL NOT NULL,
  "publicId" TEXT NOT NULL,
  "orderId" INTEGER NOT NULL,
  "productId" INTEGER,
  "code" TEXT NOT NULL,
  "status" "TicketStatus" NOT NULL DEFAULT 'AVAILABLE',
  "buyerFullName" TEXT,
  "buyerDocNumber" TEXT,
  "buyerEmail" TEXT,
  "buyerPhone" TEXT,
  "assignedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ticket_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_codes_publicId_key" ON "ticket_codes"("publicId");
CREATE UNIQUE INDEX "ticket_codes_code_key" ON "ticket_codes"("code");

-- CreateIndex
CREATE INDEX "ticket_codes_orderId_idx" ON "ticket_codes"("orderId");
CREATE INDEX "ticket_codes_status_idx" ON "ticket_codes"("status");

-- AddForeignKey
ALTER TABLE "ticket_codes" ADD CONSTRAINT "ticket_codes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_codes" ADD CONSTRAINT "ticket_codes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddValue: proveedor de pagos Izipay (enum PaymentProvider)
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'IZIPAY';