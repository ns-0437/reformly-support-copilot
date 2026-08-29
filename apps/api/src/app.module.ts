import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { PrismaModule } from './prisma.module';
import { ChatModule } from './modules/chat/chat.module';
import { EscalationModule } from './modules/escalation/escalation.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { RagModule } from './modules/rag/rag.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    // No self-protection existed before this — every route, including the
    // unauthenticated public /chat/message, could be hit without limit.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }]),
    PrismaModule,
    JobsModule,
    RagModule,
    ChatModule,
    EscalationModule,
    WebhooksModule,
    ObservabilityModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
