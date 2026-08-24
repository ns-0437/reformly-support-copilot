import { Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatController } from './chat.controller';
import { LlmModule } from '../llm/llm.module';
import { ReliabilityModule } from '../reliability/reliability.module';
import { EscalationModule } from '../escalation/escalation.module';

@Module({
  imports: [LlmModule, ReliabilityModule, EscalationModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
