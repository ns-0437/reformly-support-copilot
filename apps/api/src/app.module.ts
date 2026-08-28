import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    PrismaModule,
    JobsModule,
    RagModule,
    ChatModule,
    EscalationModule,
    WebhooksModule,
    ObservabilityModule,
    HealthModule,
  ],
})
export class AppModule {}
