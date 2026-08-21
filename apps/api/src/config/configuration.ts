export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },
  llm: {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'claude-sonnet-5',
    mock: (process.env.MOCK_LLM ?? 'true') === 'true',
  },
  embeddings: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    mock: (process.env.MOCK_EMBEDDINGS ?? 'true') === 'true',
  },
  reliability: {
    escalationThreshold: parseFloat(
      process.env.CONFIDENCE_ESCALATION_THRESHOLD ?? '0.62',
    ),
    autoEscalateHighRiskTools:
      (process.env.AUTO_ESCALATE_HIGH_RISK_TOOLS ?? 'true') === 'true',
  },
  providers: {
    failureRate: parseFloat(process.env.PROVIDER_FAILURE_RATE ?? '0.25'),
    timeoutRate: parseFloat(process.env.PROVIDER_TIMEOUT_RATE ?? '0.1'),
  },
});
