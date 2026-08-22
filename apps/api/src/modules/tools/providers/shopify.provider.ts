import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma.service';
import { retryWithBackoff } from '../../../common/retry/retry-with-backoff';

/**
 * Stand-in for the real Shopify Admin API. Reformly's actual order data
 * lives in Shopify; this provider hits our own Postgres mirror instead but
 * deliberately injects the failure modes a real third-party API exhibits
 * (timeouts, transient 5xx) so the retry/backoff and idempotency paths above
 * it are exercised the same way they would be in production.
 */
@Injectable()
export class ShopifyProvider {
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
      throw new Error('ShopifyProvider: upstream timeout');
    }
    if (roll < this.timeoutRate + this.failureRate) {
      throw new Error('ShopifyProvider: upstream 502 Bad Gateway');
    }
  }

  async getOrderByExternalId(externalId: string) {
    return retryWithBackoff(
      async () => {
        await this.simulateFlakiness();
        return this.prisma.order.findUnique({ where: { externalId } });
      },
      {
        maxAttempts: 3,
        onRetry: (attempt, err) =>
          console.warn(`[ShopifyProvider] retry ${attempt} after: ${(err as Error).message}`),
      },
    );
  }

  async getOrdersForCustomer(customerId: string) {
    return retryWithBackoff(async () => {
      await this.simulateFlakiness();
      return this.prisma.order.findMany({
        where: { customerId },
        orderBy: { placedAt: 'desc' },
      });
    });
  }
}
