-- Alinea las columnas con la convencion camelCase del resto del schema
-- (Prisma usa el nombre del campo como columna por defecto).
ALTER TABLE "users" RENAME COLUMN "refresh_token_hash" TO "refreshTokenHash";
ALTER TABLE "users" RENAME COLUMN "refresh_token_expires_at" TO "refreshTokenExpiresAt";
ALTER TABLE "users" RENAME COLUMN "failed_logins" TO "failedLogins";
ALTER TABLE "users" RENAME COLUMN "lockout_until" TO "lockoutUntil";