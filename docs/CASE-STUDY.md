# Reformly Copilot — Case Study

An AI support agent that decides for itself when it shouldn't decide alone.

**Live app:** https://web-mu-kohl-77.vercel.app
**API:** https://reformly-api-721473915245.asia-south1.run.app

Order status, refunds, and subscription changes for a fitness-equipment subscription business, handled by an LLM with real tool-calling, backed by a confidence score that routes anything risky or uncertain to a human before it ever reaches the customer.

## Tech stack, and why

Nothing here is a default choice — each tool earns its place against something the system actually needs to do.

### Application

| Tech | Role | Why |
|---|---|---|
| NestJS | Backend framework | Structured, dependency-injected modules for a system with real seams — LLM, tools, RAG, jobs, reliability, and escalation all need to stay independently testable, not tangled in one Express file. |
| PostgreSQL | Data | Orders, subscriptions, conversations, and audit trails are all genuinely relational — this isn't a document-shaped problem. |
| pgvector | RAG | Runs the knowledge-base similarity search inside the same Postgres instance as the transactional data. One database instead of a database plus a separate vector store to keep in sync. |
| Prisma | ORM | Typed schema and migrations, with a raw-SQL escape hatch for the one thing it doesn't model natively: the pgvector column and its cosine-distance queries. |
| BullMQ + Redis | Background jobs | Refund settlement shouldn't block a chat reply on a slow payment processor. Jobs are keyed so a retried or duplicate enqueue is a no-op, not a double refund. |
| Claude (tool-calling) | LLM | The model calls real tools — order lookup, refund eligibility, KB search — instead of free-text answers. A dedicated `submit_final_response` tool forces a validated reply shape. |
| Zod | Validation | The model's structured output is re-validated on the server regardless of what the API claims — a malformed call gets fed back as an error and retried, not trusted. |
| Next.js + Tailwind | Dashboard | A chat tester, an escalation review queue, and a cost/reliability dashboard — three small screens that don't need more than the App Router gives for free. |
| Sentry | Observability | No-op with no DSN configured, so the whole app runs and tests locally without an account — one env var away from real error tracking in production. |

### Infrastructure & delivery

| Tech | Role | Why |
|---|---|---|
| Docker | Packaging | One reproducible image for the API, built from the repo root so npm workspaces resolve correctly, that runs identically on a laptop and on Cloud Run. |
| Google Cloud Run | Backend host | Serverless containers billed by usage. Scales to zero when idle, and can hold one CPU-always-allocated instance when the background worker needs to actually run. |
| Vercel | Frontend host | Next.js's native platform — zero-config builds, instant production URLs. Splitting hosting from the API doesn't add real complexity; it removes Next.js-specific configuration from GCP instead. |
| Supabase | Managed Postgres | Postgres with pgvector enabled out of the box, so the database and the RAG store are provisioned together, not stitched from two vendors. |
| Upstash | Managed Redis | Serverless Redis reachable over TLS from anywhere, sized for a queue that handles one refund job at a time, not a cache under real load. |
| GitHub Actions | CI | Every push builds against real Postgres and Redis service containers and runs the Prisma migration for real, so "it migrates" is verified, not assumed. |

## Architecture

How a message actually moves through the system: one request triggers two things at once — an answer for the customer, and, if a refund is involved, a background job that finishes independently of the chat reply.

```mermaid
flowchart LR
    subgraph SYNC["Synchronous — one HTTP request/response"]
        A[Browser<br/>Vercel · Next.js] -->|POST /chat/message| B[Chat API<br/>Cloud Run]
        B -->|generate| C[Tool-calling loop<br/>Claude / mock]
        C -->|tool_use| D[Tools + RAG<br/>retry + backoff]
        D -->|result| E{Reliability score}
        E -->|confident| A
        E -->|"low confidence /<br/>high-risk / failed tool"| F[Escalation queue<br/>human review]
        F -->|resolves| A
    end
    subgraph ASYNC["Asynchronous — finishes after the reply is sent"]
        G[(Redis queue<br/>Upstash · BullMQ)]
        H[Refund worker<br/>idempotent · resumable]
        D -->|enqueue refundId| G
        G --> H
    end
    P[(Postgres<br/>Supabase · pgvector)]
    B -.->|history| P
    D -.->|lookups + search| P
    H -.->|status → processed| P
```

1. **The model can't just answer.** Every turn must end by calling a `submit_final_response` tool carrying a confidence number, not free text — that's what makes the next step possible.
2. **Confidence is computed, not trusted.** The model's own number is blended 60/40 with whether its tool calls actually succeeded. A model that "sounds sure" after a failed lookup still gets overridden.
3. **Risk beats confidence.** Anything that touches billing (pausing a subscription) is escalated to a human automatically, regardless of how confident the model is.
4. **Money moves off the request path.** Refund eligibility is decided synchronously; the payment-processor call happens in a queued job so a slow provider never makes the chat hang.

## Build journey

Real, sequential commit history — each phase below is a working state, not a checkpoint invented after the fact.

1. **Foundation** — monorepo scaffold, the full Prisma schema for the domain (customers, orders, subscriptions, conversations, escalations), and a bare NestJS app wired to Postgres.
2. **Simulated reality** — Shopify and Stripe stand-ins that deliberately fail and time out at a configurable rate, wrapped in one shared retry-with-backoff helper, so unreliable APIs are a first-class condition, not an afterthought.
3. **Knowledge & jobs** — pgvector-backed policy search, plus the idempotent, resumable BullMQ pipeline that actually moves refund money — deciding and processing kept as two separate steps, on purpose.
4. **The brain** — the Claude tool-calling loop with Zod-validated structured output and a retry loop for malformed responses, plus a deterministic mock mode that exercises the exact same code path with no API key.
5. **Trust engine** — the confidence-blending formula, the high-risk auto-escalation policy, and the human review queue where a person, not the model, has the last word on anything escalated.
6. **Wiring it together** — end-to-end chat orchestration, idempotent inbound webhooks keyed on the provider's own event id, cost/usage logging on every LLM call, and seed data to develop against.
7. **Dashboard** — a Next.js app with three screens: a chat tester, the escalation review queue with approve/edit/reject, and a live analytics view of cost and tool reliability.
8. **Hardening** — unit tests for the retry helper and the reliability scorer, a real bug fix (an unknown conversation ID was leaking a raw 500 instead of a clean 404), Sentry error tracking, and a GitHub Actions pipeline that runs migrations against real Postgres and Redis containers on every push.
9. **Shipping it** — a production Docker image, a Cloud Run service, a Supabase database, an Upstash queue, and a Vercel frontend — and the incidents below, all only visible once the app was actually live.

## Production incidents

All of these only showed up after deploying — none reproduced locally. That's the whole argument for testing against the real target, not just localhost.

### 1. Refund jobs created, never processed

**Signal** — a refund's status sat at `eligible` forever in Supabase. No error, anywhere, in any log.

**Root cause** — Cloud Run only allocates CPU to a container while it's serving a request, by default. The BullMQ worker runs in the same process but processes jobs *between* requests — it was being starved of CPU entirely.

**Fix** — `--no-cpu-throttling`. CPU stays allocated whenever the container is running, request or not.

### 2. The same jobs, hanging instead of erroring

**Signal** — even after fixing the CPU throttling, the request that enqueues a job hung for minutes — not slow, *stuck*, with zero errors.

**Root cause** — Upstash's hostname resolves to both an A (IPv4) and AAAA (IPv6) record. Cloud Run's route to the IPv6 address was broken — the handshake never completed and never failed either.

**Fix** — force `family: 4` on the Redis connection, plus `maxRetriesPerRequest: null` per BullMQ's own documented requirement.

```mermaid
flowchart TD
    subgraph before["Before"]
        A1[Cloud Run] -->|DNS lookup| B1[AAAA · IPv6]
        B1 -.->|"route broken — no SYN, no RST"| C1[Hangs forever]
    end
    subgraph after["After"]
        A2[Cloud Run] -->|"family: 4"| B2[A · IPv4]
        B2 -->|TLS connect| C2[Connects instantly]
    end
```

Worked perfectly locally — bare Node, and even a local Docker container against real Upstash. Only reproduced on Cloud Run's specific network path, which is exactly the kind of environment-specific failure that's easy to miss without testing against the real deployment target.
