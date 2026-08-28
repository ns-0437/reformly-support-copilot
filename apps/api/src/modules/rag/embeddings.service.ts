import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const EMBEDDING_DIM = 1536;

// Without this, cosine similarity between ANY two English sentences is
// inflated by shared function words ("you", "have", "a", "to"...) — enough
// to clear a naive confidence threshold for completely unrelated queries.
// A real embedding model doesn't have this failure mode; the mock has to
// correct for it explicitly.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him',
  'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'this',
  'that', 'these', 'those', 'is', 'am', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'shall', 'should', 'can', 'could', 'may', 'might', 'must', 'to', 'of',
  'in', 'on', 'at', 'by', 'for', 'with', 'about', 'against', 'between',
  'into', 'through', 'during', 'before', 'after', 'above', 'below', 'from',
  'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'and', 'but', 'or', 'so', 'if', 'not', 'no', 'nor', 'as', 'than',
  'too', 'very', 'just', 'want', 'need', 'get', 'got', 'like', 'please',
]);

/**
 * Wraps whichever embedding provider is configured. Falls back to a
 * deterministic local hash-embedding when no OPENAI_API_KEY is set, so RAG
 * search is reviewable/testable end-to-end without a paid key. Swap
 * `embedMock` for a real OpenAI call by flipping MOCK_EMBEDDINGS=false.
 */
@Injectable()
export class EmbeddingsService {
  private readonly mock: boolean;

  constructor(private readonly config: ConfigService) {
    this.mock = this.config.get<boolean>('embeddings.mock') ?? true;
  }

  async embed(text: string): Promise<number[]> {
    if (this.mock) return this.embedMock(text);
    return this.embedOpenAi(text);
  }

  private async embedOpenAi(text: string): Promise<number[]> {
    const apiKey = this.config.get<string>('embeddings.apiKey');
    const model = this.config.get<string>('embeddings.model');
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ input: text, model }),
    });
    if (!res.ok) {
      throw new Error(`Embeddings API error: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data[0].embedding;
  }

  /**
   * Deterministic bag-of-words hash embedding. Not semantically meaningful
   * beyond crude token overlap, but stable and dependency-free — good enough
   * to prove the pgvector plumbing (storage, cosine search, top-k) works.
   */
  private embedMock(text: string): number[] {
    const vector = new Array(EMBEDDING_DIM).fill(0);
    const tokens = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
      (token) => !STOPWORDS.has(token),
    );
    for (const token of tokens) {
      const hash = crypto.createHash('sha256').update(token).digest();
      for (let i = 0; i < 8; i++) {
        const idx = hash.readUInt16BE(i * 2) % EMBEDDING_DIM;
        vector[idx] += 1;
      }
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}
