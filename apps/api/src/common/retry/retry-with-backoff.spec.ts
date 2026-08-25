import { retryWithBackoff, RetryExhaustedError } from './retry-with-backoff';

describe('retryWithBackoff', () => {
  it('returns the result on first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds once the underlying call recovers', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('recovered');

    const onRetry = jest.fn();
    const result = await retryWithBackoff(fn, { maxAttempts: 4, baseDelayMs: 1, onRetry });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('throws RetryExhaustedError after exhausting all attempts', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('permanent failure'));

    await expect(retryWithBackoff(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(
      RetryExhaustedError,
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
