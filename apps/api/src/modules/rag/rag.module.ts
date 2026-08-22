import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { EmbeddingsService } from './embeddings.service';

@Module({
  providers: [RagService, EmbeddingsService],
  exports: [RagService, EmbeddingsService],
})
export class RagModule {}
