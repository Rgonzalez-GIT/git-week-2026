import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { setupSecurity } from './security.js';
import { setupRequestLogging } from './observability.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  setupSecurity(app);
  setupRequestLogging(app);

  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('GIT Week 2026 API')
    .setDescription(
      'API de comercio electrónico del 2º GIT Week 2026 (UNI): planes de inscripción, ' +
      'carrito, reservas, checkout, cupones y pagos. Autenticación JWT Bearer.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('Bootstrap').log(`API escuchando en http://localhost:${port}`);
  new Logger('Bootstrap').log(`Swagger en http://localhost:${port}/docs`);
}
await bootstrap();