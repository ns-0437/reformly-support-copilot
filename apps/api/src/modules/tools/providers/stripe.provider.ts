import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma.service';
import { retryWithBackoff } from '../../../common/retry/retry-with-backoff';

/**
 * Stand-in for the real Stripe API (subscriptions + refunds). Same flakiness
 * simulation as ShopifyProvider — the point is to prove the surrounding
 * system (retries, idempotency, escalation) survives an unreliable vendor,
 * not to reimplement Stripe.
 */
@Injectable()
export class StripeProvider {
  private readonly failureRate: number;
  private readonly timeoutRate: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.failureRate = this.config.get<number>('providers.failureRate') ?? 0.25;
    this.timeoutRate = this.config.get<number>('providers.timeoutRate') ?? 0.1;
  }

  private async simulateFlakiness(): Promise<void> {
    const roll = Math.random();
    if (roll < this.timeoutRate) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      throw new Error('StripeProvider: upstream timeout');
    }
    if (roll < this.timeoutRate + this.failureRate) {
      throw new Error('StripeProvider: upstream 503 Service Unavailable');
    }
  }

  async getSubscriptionByExternalId(externalId: string) {
    return retryWithBackoff(async () => {
      await this.simulateFlakiness();
      return this.prisma.subscription.findUnique({ where: { externalId } });
    });
  }

  async getSubscriptionsForCustomer(customerId: string) {
    return retryWithBackoff(async () => {
      await this.simulateFlakiness();
      return this.prisma.subscription.findMany({ where: { customerId } });
    });
  }

  /**
   * Pausing a subscription is a money-affecting mutation. Real Stripe calls
   * are idempotent via an `Idempotency-Key` header; here the same key is
   * checked against our own record before any state change so a retried
   * webhook or a retried tool call can never double-apply the pause.
   */
  async pauseSubscription(externalId: string, resumeAt: Date) {
    return retryWithBackoff(async () => {
      await this.simulateFlakiness();
      return this.prisma.subscription.update({
        where: { externalId },
        data: { status: 'paused', pausedUntil: resumeAt },
      });
    });
  }

  /**
   * Issues the actual refund against the payment processor. Deliberately
   * separate from the eligibility check (ToolsService.check_refund_eligibility)
   * so "decide" and "move money" are different steps — the latter runs in a
   * background job (see RefundProcessor) rather than blocking the chat reply.
   */
  // amountCents isn't used by the mock body below, but stays part of the
  // signature — a real Stripe refund call needs it, and dropping it now
  // would silently break the interface once this stops being a stand-in.
  async issueRefund(_amountCents: number): Promise<{ processorRefundId: string }> {
    return retryWithBackoff(async () => {
      await this.simulateFlakiness();
      return { processorRefundId: `re_${Math.random().toString(36).slice(2, 12)}` };
    });
  }
}
