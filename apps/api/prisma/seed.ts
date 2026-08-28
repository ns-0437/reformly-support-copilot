import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();
const EMBEDDING_DIM = 1536;

// Standalone copy of EmbeddingsService's mock hash-embedding — seeding runs
// outside the Nest DI container, so this intentionally doesn't import app
// code. If MOCK_EMBEDDINGS=false in your .env, re-run `npm run seed` for the
// KnowledgeDocument rows only after wiring a real embed call here.
//
// The stopword list MUST stay identical to embeddings.service.ts — these
// embeddings and a runtime query embedding are compared by cosine similarity,
// so seeding with a different token filter than search time silently breaks
// relevance instead of erroring.
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

function embedMock(text: string): number[] {
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

async function seedKnowledgeBase() {
  const docs = [
    {
      title: 'Refund policy',
      category: 'returns',
      content:
        'Orders can be refunded in full within 30 days of the purchase date, provided the board has not been used beyond a trial period. After 30 days, refunds are handled case-by-case by support.',
    },
    {
      title: 'Shipping times',
      category: 'shipping',
      content:
        'UK orders typically ship within 2-4 business days and arrive within 5-7 business days. International orders can take 10-14 business days depending on customs.',
    },
    {
      title: 'Board assembly',
      category: 'product',
      content:
        'The Reformly board ships flat-packed with all required tools included. Assembly takes about 15 minutes — instructions are in the box and a video walkthrough is linked on the packing slip.',
    },
    {
      title: 'Pausing your subscription',
      category: 'subscription',
      content:
        'You can pause your app subscription for up to 3 months at a time from Account > Subscription > Pause. Billing resumes automatically on the date you choose, and you can resume early at any time.',
    },
    {
      title: 'Cancelling your subscription',
      category: 'subscription',
      content:
        'Cancelling stops future billing immediately but keeps app access until the end of the current billing period. There is no cancellation fee.',
    },
  ];

  for (const doc of docs) {
    const created = await prisma.knowledgeDocument.create({
      data: { title: doc.title, category: doc.category, content: doc.content },
    });
    const embedding = embedMock(`${doc.title}\n${doc.content}`);
    await prisma.$executeRawUnsafe(
      `UPDATE "KnowledgeDocument" SET embedding = $1::vector WHERE id = $2`,
      `[${embedding.join(',')}]`,
      created.id,
    );
  }
  console.log(`Seeded ${docs.length} knowledge base documents`);
}

async function seedCustomers() {
  const customer = await prisma.customer.create({
    data: { email: 'jane.doe@example.com', name: 'Jane Doe' },
  });

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  await prisma.order.createMany({
    data: [
      {
        customerId: customer.id,
        externalId: 'RFM-10234',
        status: 'shipped',
        productName: 'Reformly Reformer Board',
        amountCents: 24900,
        placedAt: new Date(now - 10 * day),
        estimatedShip: new Date(now - 7 * day),
      },
      {
        customerId: customer.id,
        externalId: 'RFM-10190',
        status: 'delivered',
        productName: 'Reformly Reformer Board + Resistance Kit',
        amountCents: 29900,
        placedAt: new Date(now - 45 * day),
        deliveredAt: new Date(now - 38 * day),
      },
    ],
  });

  await prisma.subscription.create({
    data: {
      customerId: customer.id,
      externalId: 'sub_reformly_001',
      plan: 'monthly',
      status: 'active',
      renewsAt: new Date(now + 12 * day),
    },
  });

  console.log(`Seeded customer ${customer.email} with 2 orders + 1 subscription`);
}

async function main() {
  await seedKnowledgeBase();
  await seedCustomers();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
