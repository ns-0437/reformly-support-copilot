import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
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
}
