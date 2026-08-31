import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  initSentry();

  // Webhook signature verification needs the exact bytes that were signed —
  // Nest's default JSON parsing re-serializes the body, which can differ
  // byte-for-byte from what the provider actually hashed.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Reformly Support Copilot API')
    .setDescription(
      'Order status, refunds, subscription changes, and policy Q&A via an LLM agent with tool-calling, confidence scoring, and human-in-the-loop escalation. /escalations and /analytics require HTTP Basic Auth.',
    )
    .setVersion('1.0')
    .addBasicAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Reformly support copilot API listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal error during bootstrap:', err);
  process.exit(1);
});
