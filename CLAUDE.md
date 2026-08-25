# Reformly Support Copilot — working notes

An AI customer-support agent for a fitness e-commerce/subscription business
(order status, refunds, subscription changes, policy Q&A via RAG). Built as
a real implementation of the "AI customer support with tool-calling" system
described in Reformly's AI Automation Engineer job post — not a toy demo.
Every reliability/production concern in that JD (unreliable third-party
APIs, idempotent webhooks, resumable background jobs, structured output
validation, confidence scoring, human-in-the-loop, cost tracking) is
implemented, not just described.

## Points to remember

1. **PrismaService is global** ([apps/api/src/prisma.module.ts](apps/api/src/prisma.module.ts)). Never add `PrismaService` to a feature module's own `providers` array — inject it directly. A second local provider would spin up a second connection pool.
2. **All outbound provider calls go through `retryWithBackoff`** ([apps/api/src/common/retry/retry-with-backoff.ts](apps/api/src/common/retry/retry-with-backoff.ts)). `ShopifyProvider`/`StripeProvider` deliberately inject random failures/timeouts (`PROVIDER_FAILURE_RATE`, `PROVIDER_TIMEOUT_RATE` in `.env`) so this path is always exercised, not just written and forgotten.
3. **Structured output is enforced via tool-calling, not prompt-asking.** The model must call `submit_final_response` (schema in [final-response.schema.ts](apps/api/src/modules/llm/schemas/final-response.schema.ts)); the result is re-validated with Zod on our side regardless of what the API returns. A malformed call is fed back as a tool error and retried up to `MAX_STRUCTURED_OUTPUT_RETRIES` (2) before failing safe into an escalation.
4. **Confidence is never just the model's self-report.** `ReliabilityService.assess()` blends `selfReportedConfidence` with objective tool-success signals (0.6/0.4 weighting) — a model that "sounds sure" after a failed tool call still gets escalated. See [reliability.service.ts](apps/api/src/modules/reliability/reliability.service.ts).
5. **High-risk tools (`pause_subscription`) always escalate**, regardless of confidence score — this is a policy decision (`AUTO_ESCALATE_HIGH_RISK_TOOLS`), not a threshold tuning problem. Add new money/account-mutating tools to `HIGH_RISK_TOOLS` in [tool-definitions.ts](apps/api/src/modules/tools/tool-definitions.ts).
6. **A human always has the last word on an escalated turn.** The AI's draft is stored but never sent to the customer directly — `EscalationService.resolve()` is what actually produces the `human_agent` message. Approve/edit/reject, all three write an audit trail (`reviewedBy`, `resolvedAt`).
7. **BullMQ job idempotency pattern**: `jobId = <domain-entity-id>` (e.g. `refundRequestId`) so re-enqueuing the same unit of work is a no-op at the queue level, AND the processor independently checks the entity's current DB status before acting (belt-and-suspenders — see [refund.processor.ts](apps/api/src/modules/jobs/processors/refund.processor.ts)). Only flip a record to a terminal `failed` state on the *last* retry attempt (`job.attemptsMade + 1 >= job.opts.attempts`), or you break the ability to retry at all.
8. **Webhook idempotency is a DB unique constraint, not a cache.** `WebhookEvent` has `@@unique([provider, externalEventId])`; the row is checked/created *before* any side effect runs. Never trust a provider to only deliver once.
9. **Every LLM call is logged for cost** (`LlmUsageLog`), even in mock mode (cost = $0). This is what powers `/analytics/summary` — don't bypass `LlmService.generateResponse` for a "quick" direct API call, or usage tracking silently goes blind for that turn.
10. **Mock mode is a first-class code path, not a stub.** `MOCK_LLM=true` (default) runs a deterministic rule-based responder that still calls the *real* `ToolsService`/`RagService`/Postgres/BullMQ — only the "which tool to call" decision is rule-based. Flipping `MOCK_LLM=false` + setting `ANTHROPIC_API_KEY` swaps in real Claude tool-calling without touching any other module. Same applies to `MOCK_EMBEDDINGS`.
11. **RAG grounding is mandatory for policy answers**: the agent is instructed to call `search_knowledge_base` rather than answer shipping/refund/subscription policy from parametric knowledge, and `citedSourceIds` in the structured response ties the answer back to a specific `KnowledgeDocument` row.
12. **Refund eligibility and refund processing are two separate steps on purpose**: `check_refund_eligibility` (tools.service.ts) decides and marks a `RefundRequest` `eligible`; the actual money movement happens asynchronously in `RefundProcessor` so a slow payment-processor call never blocks the chat response.

## Code structure

```
reformly-support-copilot/
├── docker-compose.yml          # Postgres (pgvector) + Redis
├── apps/
│   ├── api/                    # NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma   # Customer/Order/Subscription/Conversation/
│   │   │   │                   # Message/ToolCall/Escalation/KnowledgeDocument/
│   │   │   │                   # WebhookEvent/LlmUsageLog
│   │   │   └── seed.ts         # sample customer, orders, subscription, KB docs
│   │   └── src/
│   │       ├── prisma.module.ts / prisma.service.ts   # @Global Prisma client
│   │       ├── common/retry/retry-with-backoff.ts      # shared backoff helper
│   │       └── modules/
│   │           ├── chat/          # POST /chat/message — orchestrates a turn
│   │           ├── llm/           # Anthropic tool-calling loop + mock loop,
│   │           │                  # Zod-validated structured output
│   │           ├── tools/         # tool execution + defs
│   │           │   └── providers/ # Shopify/Stripe stand-ins (inject flakiness)
│   │           ├── rag/           # pgvector embeddings + cosine search
│   │           ├── reliability/   # confidence blending + escalation policy
│   │           ├── escalation/    # human-in-the-loop queue + resolve endpoint
│   │           ├── jobs/          # BullMQ: async, idempotent refund processing
│   │           ├── webhooks/      # idempotent inbound Shopify/Stripe events
│   │           └── observability/ # /analytics/summary (cost, escalation rate,
│   │                               # tool success rate)
│   └── web/                    # Next.js (App Router) + Tailwind dashboard
│       └── app/
│           ├── page.tsx            # chat tester
│           ├── escalations/        # human review queue UI
│           └── analytics/          # cost/reliability dashboard
```

## Running it

```bash
docker compose up -d postgres redis
npm install
npm run prisma:migrate --workspace=apps/api
npm run seed --workspace=apps/api
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:3000
```

Default `.env` runs with `MOCK_LLM=true` / `MOCK_EMBEDDINGS=true` — no API
keys required to see the full pipeline (tool-calling, RAG, escalation,
background jobs) working. Set `ANTHROPIC_API_KEY` and `MOCK_LLM=false` to
swap in real Claude for the actual interview demo.

## Live deployment

- **Frontend**: https://web-mu-kohl-77.vercel.app (Vercel, Next.js)
- **Backend**: https://reformly-api-721473915245.asia-south1.run.app (Cloud Run, `asia-south1`)
- **Database**: Supabase Postgres (`ap-south-1`, pgvector enabled) — project ref `cklvgohqlbkanhwmeiop`
- **Redis**: Upstash (`asia-northeast1`, TLS)
- Cloud Run service runs with `--no-cpu-throttling` and `MOCK_LLM=true`.
- Redeploy the API after a code change: `docker build -f apps/api/Dockerfile -t asia-south1-docker.pkg.dev/reformly-support-copilot/reformly/api:latest . && docker push ... && gcloud run deploy reformly-api --image=... --project=reformly-support-copilot --region=asia-south1`
- Redeploy the dashboard: `cd apps/web && npx vercel --prod`

### Production incidents hit deploying this (good interview material — this is exactly the "handling unreliable APIs in production" scenario the JD asks about)

**Incident 1 — refund jobs created but never processed, Cloud Run's default CPU throttling.**
Cloud Run only allocates CPU to a container while it's actively serving an HTTP request by default. `RefundProcessor` (the BullMQ worker) runs in the same process as the HTTP server but processes jobs asynchronously *between* requests — so it was being starved of CPU and never got to run. Fix: `--no-cpu-throttling` (CPU always allocated) so there's always CPU available to process the queue whenever the container is running. Diagnosed by checking `RefundRequest.status` directly in Supabase — stuck at `eligible`, never advancing to `processed`, with zero corresponding error logs.

**Incident 2 — the same jobs hung indefinitely instead of erroring, even after fixing #1.**
`RefundQueueProducer.enqueue()` (a BullMQ `queue.add()` call to Upstash) hung forever with no timeout and no error — not slow, *stuck*. Root cause: Upstash's hostname resolves to both A and AAAA records, and Cloud Run's IPv6 route to it was broken — the TCP handshake never completed and never failed either (a classic silent-blackhole failure mode, worse than an outright rejection because nothing times out to reveal it). Fixed by forcing `family: 4` on the ioredis connection config in [jobs.module.ts](apps/api/src/modules/jobs/jobs.module.ts), plus setting `maxRetriesPerRequest: null` per BullMQ's own documented requirement. Worked perfectly locally (bare Node, and even in a local Docker container against real Upstash) — only reproduced on Cloud Run's specific network path, which is exactly the kind of environment-specific failure that's easy to miss without testing against the real deployment target.

Both fixes are load-bearing: dropping `--no-cpu-throttling` or the `family: 4` override reintroduces the corresponding failure the next time the service scales from zero.
