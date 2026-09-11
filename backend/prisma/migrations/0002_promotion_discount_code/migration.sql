-- AlterTable
ALTER TABLE "promotions" ADD COLUMN "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "promotions_code_key" ON "promotions"("code");