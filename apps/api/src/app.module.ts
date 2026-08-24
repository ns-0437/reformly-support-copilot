import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { PrismaModule } from './prisma.module';
import { RagModule } from './modules/rag/rag.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { EscalationModule } from './modules/escalation/escalation.module';
import { ChatModule } from './modules/chat/chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    RagModule,
    JobsModule,
    EscalationModule,
    ChatModule,
  ],
})
export class AppModule {}
