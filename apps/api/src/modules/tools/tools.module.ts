import { Module } from '@nestjs/common';
import { ToolsService } from './tools.service';
import { ProvidersModule } from './providers/providers.module';
import { RagModule } from '../rag/rag.module';
import { JobsModule } from '../jobs/jobs.module';

@Module({
  imports: [ProvidersModule, RagModule, JobsModule],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}
