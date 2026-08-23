import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [ToolsModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
