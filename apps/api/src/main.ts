import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initSentry } from './observability/sentry';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  initSentry();

  // Webhook signature verification needs the exact bytes that were signed —
  // Nest's default JSON parsing re-serializes the body, which can differ
  // byte-for-byte from what the provider actually hashed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Cloud Run sits in front of this as a single reverse-proxy hop. Without
  // this, Express sees every request as coming from that proxy's internal
  // address, not the real client — so ThrottlerGuard's per-IP rate limit
  // was effectively bucketing every visitor together instead of separately.
  app.set('trust proxy', 1);

  // CSP off: this is a JSON API plus the Swagger UI at /docs, which needs
  // inline scripts/styles that helmet's default CSP blocks by default. The
  // other headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
  // stay on — CSP is the one that needs page-specific tuning to be useful,
  // and getting it wrong silently breaks /docs rather than failing loudly.
  app.use(helmet({ contentSecurityPolicy: false }));

  const config = app.get(ConfigService);
  app.enableCors({ origin: config.get<string[]>('cors.allowedOrigins') });
  // forbidNonWhitelisted turns an unexpected field into a clear 400 instead
  // of whitelist:true's default of silently dropping it — a client with a
  // typo'd field name deserves an error, not data quietly going nowhere.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
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
