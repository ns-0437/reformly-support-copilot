# Reformly Support Copilot

AI customer-support agent for a fitness e-commerce + subscription app: order
status, refunds, subscription changes, and policy Q&A, with tool-calling,
RAG, confidence-scored responses, human-in-the-loop escalation for anything
risky or uncertain, and the production concerns that come with it — retries
on flaky APIs, idempotent webhooks, resumable background jobs, structured
output validation, and cost tracking.

## Stack

NestJS · PostgreSQL + pgvector · Prisma · BullMQ/Redis · Anthropic Claude
(tool-calling) · Zod · Next.js (App Router) + Tailwind

## Quick start

```bash
docker compose up -d postgres redis
npm install
npm run prisma:migrate --workspace=apps/api
npm run seed --workspace=apps/api
npm run dev:api    # NestJS API on :3001
npm run dev:web    # Next.js dashboard on :3000
```

Runs fully offline by default (`MOCK_LLM=true`, `MOCK_EMBEDDINGS=true` in
`.env.example`) — no API keys needed to exercise the whole pipeline. Set
`ANTHROPIC_API_KEY` + `MOCK_LLM=false` to use real Claude.

Try in the chat UI (`/`):
- `Whats the status of order RFM-10234?`
- `I want a refund for RFM-10234, it arrived broken`
- `Can I pause my subscription for a month?` (routes to human review — see `/escalations`)

See [CLAUDE.md](CLAUDE.md) for architecture notes and working rules.
