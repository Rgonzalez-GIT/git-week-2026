-- Fase 12 - Autenticación JWT: refresh token + control de intentos de login.
ALTER TABLE "users" ADD COLUMN "refresh_token_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "refresh_token_expires_at" TIMESTAMP WITH TIME ZONE;
ALTER TABLE "users" ADD COLUMN "failed_logins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "lockout_until" TIMESTAMP WITH TIME ZONE;