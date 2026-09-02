import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

interface InboundWebhook {
  provider: 'shopify' | 'stripe';
  externalEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

// Mirrors the comment on Order.status / Subscription.status in schema.prisma
// — a validly-signed webhook with a malformed or unexpected status value
// (a sender bug, a typo, an API version drift) got written straight into
// the domain model before this, with nothing to catch it.
const VALID_ORDER_STATUSES = new Set(['pending', 'fulfilled', 'shipped', 'delivered', 'delayed', 'refunded']);
const VALID_SUBSCRIPTION_STATUSES = new Set(['active', 'paused', 'cancelled', 'past_due']);

/**
 * Real Shopify/Stripe webhooks can and do arrive more than once for the same
 * event (retried delivery after a slow 2xx, at-least-once delivery
 * guarantees, etc). The provider's event id is the only thing we can trust
 * to dedupe on — the fix is a unique constraint on (provider, externalEventId)
 * checked *before* any side effect runs, not a best-effort in-memory cache.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(event: InboundWebhook): Promise<{ status: 'processed' | 'duplicate_ignored' | 'failed' }> {
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { provider_externalEventId: { provider: event.provider, externalEventId: event.externalEventId } },
    });

    if (existing) {
      this.logger.log(`Duplicate ${event.provider} webhook ${event.externalEventId}, ignoring`);
      return { status: 'duplicate_ignored' };
    }

    const record = await this.prisma.webhookEvent.create({
      data: {
        provider: event.provider,
        externalEventId: event.externalEventId,
        eventType: event.eventType,
        payload: event.payload as any,
      },
    });

    try {
      await this.applySideEffect(event);
      await this.prisma.webhookEvent.update({
        where: { id: record.id },
        data: { status: 'processed', processedAt: new Date() },
      });
      return { status: 'processed' };
    } catch (err) {
      this.logger.error(`Failed to apply ${event.provider}/${event.eventType}: ${(err as Error).message}`);
      await this.prisma.webhookEvent.update({ where: { id: record.id }, data: { status: 'failed' } });
      return { status: 'failed' };
    }
  }

  private async applySideEffect(event: InboundWebhook): Promise<void> {
    if (event.provider === 'shopify' && event.eventType === 'order.status_changed') {
      const { orderExternalId, status } = event.payload as { orderExternalId: string; status: string };
      if (!VALID_ORDER_STATUSES.has(status)) {
        throw new Error(`Rejected order.status_changed with unknown status "${status}"`);
      }
      await this.prisma.order.update({ where: { externalId: orderExternalId }, data: { status } });
      return;
    }

    if (event.provider === 'stripe' && event.eventType === 'subscription.updated') {
      const { subscriptionExternalId, status } = event.payload as {
        subscriptionExternalId: string;
        status: string;
      };
      if (!VALID_SUBSCRIPTION_STATUSES.has(status)) {
        throw new Error(`Rejected subscription.updated with unknown status "${status}"`);
      }
      await this.prisma.subscription.update({ where: { externalId: subscriptionExternalId }, data: { status } });
      return;
    }

    this.logger.warn(`No handler for ${event.provider}/${event.eventType} — stored but not applied`);
  }
}
