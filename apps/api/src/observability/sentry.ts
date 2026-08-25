import * as Sentry from '@sentry/node';

/**
 * No-op when SENTRY_DSN isn't set — lets the whole app run locally/in CI
 * without a Sentry account while still being one env var away from real
 * error tracking in production, which is the point of the interview: this
 * is the "respond to production failures" half of the job, not a plugin
 * bolted on afterward.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
  });
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
