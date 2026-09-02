import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_NAMES } from './queue.constants';

@Injectable()
export class RefundQueueProducer {
  constructor(@InjectQueue(QUEUE_NAMES.REFUND_PROCESSING) private readonly queue: Queue) {}

  /**
   * jobId = refundRequestId makes enqueue itself idempotent: if this refund
   * was already queued (e.g. a retried chat request re-runs the tool call),
   * BullMQ silently no-ops the duplicate add instead of double-queuing work.
   */
  async enqueue(refundRequestId: string) {
    await this.queue.add(
      'process-refund',
      { refundRequestId },
      {
        jobId: refundRequestId,
        attempts: 4,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  /** Used by /health — a broken Redis connection is exactly what caused a real production incident (see docs/CASE-STUDY.md), so it's worth surfacing before it silently strands jobs again. */
  async ping(): Promise<boolean> {
    // BullMQ types .client as a minimal command subset that doesn't include
    // ping() even though the runtime object is a full ioredis client.
    const client = (await this.queue.client) as unknown as Redis;
    const reply = await client.ping();
    return reply === 'PONG';
  }
}
