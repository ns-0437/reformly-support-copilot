export class RetryExhaustedError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = 'RetryExhaustedError';
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Called before each retry so callers can log/track attempt counts. */
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Retries `fn` with exponential backoff + jitter. Third-party APIs in
 * production fail intermittently (timeouts, 5xx, rate limits) — this is the
 * one retry helper every outbound call in this codebase goes through so
 * backoff behavior stays consistent and testable in one place.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 200, maxDelayMs = 3000, onRetry } = options;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      onRetry?.(attempt, err);
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const jitter = Math.random() * exponential * 0.3;
      await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
    }
  }
  throw new RetryExhaustedError(
    `All ${maxAttempts} attempts failed`,
    lastError,
  );
}
