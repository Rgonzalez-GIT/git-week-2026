# Fase 17 - Backend NestJS (multi-stage build + runtime)
# El cliente Prisma se genera en build con la config explícita del repo
# (prisma7.config.ts); el contenedor NO lleva secretos ni .env.

FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY prisma7.config.ts ./
COPY prisma ./prisma

RUN npm ci --legacy-peer-deps

ENV DATABASE_URL="postgresql://gitweek:gitweek_dev@localhost:5432/gitweek?schema=public"
RUN npx prisma generate --config prisma7.config.ts

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --legacy-peer-deps --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Archivos necesarios para que prisma migrate y el seed funcionen dentro del contenedor
COPY --from=build /app/prisma7.config.ts ./
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist/generated ./src/generated

EXPOSE 3001
USER node
CMD ["node", "dist/main.js"]