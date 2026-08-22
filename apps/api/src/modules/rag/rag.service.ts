import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { EmbeddingsService } from './embeddings.service';

export interface RagResult {
  id: string;
  title: string;
  content: string;
  category: string;
  similarity: number;
}

@Injectable()
export class RagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  async indexDocument(title: string, content: string, category: string) {
    const embedding = await this.embeddings.embed(`${title}\n${content}`);
    const vectorLiteral = `[${embedding.join(',')}]`;
    const doc = await this.prisma.knowledgeDocument.create({
      data: { title, content, category },
    });
    await this.prisma.$executeRawUnsafe(
      `UPDATE "KnowledgeDocument" SET embedding = $1::vector WHERE id = $2`,
      vectorLiteral,
      doc.id,
    );
    return doc;
  }

  /**
   * Cosine-similarity top-k search via pgvector's `<=>` operator. This is
   * the RAG grounding step: the LLM only cites policy that actually exists
   * in this table, rather than inventing a shipping/refund answer.
   */
  async search(query: string, topK = 3): Promise<RagResult[]> {
    const queryEmbedding = await this.embeddings.embed(query);
    const vectorLiteral = `[${queryEmbedding.join(',')}]`;

    const rows = await this.prisma.$queryRawUnsafe<
      { id: string; title: string; content: string; category: string; distance: number }[]
    >(
      `SELECT id, title, content, category, embedding <=> $1::vector AS distance
       FROM "KnowledgeDocument"
       WHERE embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT $2`,
      vectorLiteral,
      topK,
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      category: r.category,
      similarity: 1 - r.distance,
    }));
  }
}
