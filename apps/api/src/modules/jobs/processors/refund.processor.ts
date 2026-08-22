import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma.service';
import { StripeProvider } from '../../tools/providers/stripe.provider';
import { QUEUE_NAMES } from '../queue.constants';

interface RefundJobData {
  refundRequestId: string;
}

/**
 * Processes refunds asynchronously so the chat response never blocks on a
 * payment-processor round trip. Written to be safely re-run: BullMQ retries
 * a job on throw (see JobsModule for attempts/backoff config), and a
 * duplicate/late-retried run of the *same* job is a no-op because we check
 * the RefundRequest's current status before touching the processor at all —
 * that's what "resumable" means in practice, not just "has retries".
 */
@Processor(QUEUE_NAMES.REFUND_PROCESSING)
export class RefundProcessor extends WorkerHost {
  private readonly logger = new Logger(RefundProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripe: StripeProvider,
  ) {
    super();
  }

  async process(job: Job<RefundJobData>): Promise<void> {
    const refundRequest = await this.prisma.refundRequest.findUnique({
      where: { id: job.data.refundRequestId },
    });

    if (!refundRequest) {
      this.logger.warn(`RefundRequest ${job.data.refundRequestId} no longer exists, skipping`);
      return;
    }

    // Idempotency guard: if a previous attempt already moved this past
    // "eligible", there is nothing left to do — this makes retried/duplicate
    // job executions safe.
    if (refundRequest.status !== 'eligible') {
      this.logger.log(`RefundRequest ${refundRequest.id} already in status=${refundRequest.status}, skipping`);
      return;
    }

    try {
      await this.stripe.issueRefund(refundRequest.amountCents ?? 0);
      await this.prisma.refundRequest.update({
        where: { id: refundRequest.id },
        data: { status: 'processed', processedAt: new Date() },
      });
      await this.prisma.order.update({
        where: { id: refundRequest.orderId },
        data: { status: 'refunded' },
      });
    } catch (err) {
      const maxAttempts = job.opts.attempts ?? 1;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;
      this.logger.error(
        `Refund ${refundRequest.id} failed on attempt ${job.attemptsMade + 1}/${maxAttempts}: ${(err as Error).message}`,
      );
      // Only flip to 'failed' once retries are exhausted — while attempts
      // remain, status stays 'eligible' so the idempotency guard above
      // still lets the next retry through instead of short-circuiting it.
      if (isFinalAttempt) {
        await this.prisma.refundRequest.update({
          where: { id: refundRequest.id },
          data: { status: 'failed' },
        });
      }
      // Re-throw so BullMQ applies the configured retry/backoff policy.
      throw err;
    }
  }
}
