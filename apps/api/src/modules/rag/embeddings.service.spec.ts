import { ConfigService } from '@nestjs/config';
import { EmbeddingsService } from './embeddings.service';

function cosine(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

describe('EmbeddingsService (mock mode)', () => {
  function makeService() {
    const config = { get: () => true } as unknown as ConfigService;
    return new EmbeddingsService(config);
  }

  it('gives two sentences sharing only stopwords near-zero similarity', async () => {
    const service = makeService();
    // Regression test: before filtering stopwords, two unrelated sentences
    // scored ~0.2-0.3 similarity purely from shared words like "you"/"a"/"to",
    // which was enough to clear the RAG confidence threshold and make the
    // agent confidently answer with an unrelated knowledge-base document.
    const a = await service.embed('You have a sickening service');
    const b = await service.embed(
      'You can pause your app subscription for up to 3 months at a time from Account > Subscription > Pause.',
    );
    expect(cosine(a, b)).toBeLessThan(0.1);
  });

  it('gives sentences sharing real content words meaningfully higher similarity', async () => {
    const service = makeService();
    // Note: this is a literal token-hash scheme with no stemming, so e.g.
    // "cancel" and "cancelling" share nothing — only exact-token overlap
    // counts. That's a known, accepted limitation of the mock (see the class
    // doc comment); this test exercises the case it's actually meant to handle.
    const query = await service.embed('Can I pause my subscription for a month?');
    const doc = await service.embed(
      'Pausing your subscription\nYou can pause your app subscription for up to 3 months at a time from Account > Subscription > Pause.',
    );
    expect(cosine(query, doc)).toBeGreaterThan(0.15);
  });
});
