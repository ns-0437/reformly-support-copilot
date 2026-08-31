import { Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import { PrismaService } from '../../prisma.service';
import { ShopifyProvider } from './providers/shopify.provider';
import { StripeProvider } from './providers/stripe.provider';
import { RagService } from '../rag/rag.service';
import { HIGH_RISK_TOOLS, ToolName } from './tool-definitions';
import { RefundQueueProducer } from '../jobs/refund-queue.producer';

export interface ToolExecutionResult {
  toolName: ToolName;
  success: boolean;
  output: unknown;
  latencyMs: number;
  retries: number;
  /** True for tools whose effect must be human-approved before it happens. */
  requiresApproval: boolean;
}

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopify: ShopifyProvider,
    private readonly stripe: StripeProvider,
    private readonly rag: RagService,
    private readonly refundQueue: RefundQueueProducer,
  ) {}

  async execute(
    conversationId: string,
    toolName: ToolName,
    input: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const startedAt = Date.now();
    const requiresApproval = HIGH_RISK_TOOLS.has(toolName);
    let success = false;
    let output: unknown;
    let retries = 0;

    try {
      output = await this.dispatch(toolName, input, conversationId);
      success = true;
    } catch (err) {
      output = { error: (err as Error).message };
      this.logger.error(`Tool ${toolName} failed: ${(err as Error).message}`);
    }

    const latencyMs = Date.now() - startedAt;

    await this.prisma.toolCall.create({
      data: {
        conversationId,
        toolName,
        input: input as any,
        output: output as any,
        success,
        latencyMs,
        retries,
      },
    });

    return { toolName, success, output, latencyMs, retries, requiresApproval };
  }

  private async dispatch(
    toolName: ToolName,
    input: Record<string, unknown>,
    conversationId: string,
  ): Promise<unknown> {
    switch (toolName) {
      case 'get_order_status': {
        const order = await this.shopify.getOrderByExternalId(
          input.orderExternalId as string,
        );
        if (!order) return { found: false };
        return {
          found: true,
          status: order.status,
          productName: order.productName,
          placedAt: order.placedAt,
          estimatedShip: order.estimatedShip,
          deliveredAt: order.deliveredAt,
        };
      }

      case 'get_subscription_status': {
        // Deliberately ignores any customerEmail the caller supplies. Trusting
        // a model- or user-typed email here would let any authenticated
        // customer read anyone else's subscription just by mentioning their
        // address in chat. The only identity ever trusted is whichever
        // customer this conversation actually belongs to.
        const conversation = await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { customer: { include: { subscriptions: true } } },
        });
        if (!conversation) return { found: false };
        return { found: true, subscriptions: conversation.customer.subscriptions };
      }

      case 'check_refund_eligibility': {
        const order = await this.shopify.getOrderByExternalId(
          input.orderExternalId as string,
        );
        if (!order) return { eligible: false, reason: 'order_not_found' };

        const ageInDays =
          (Date.now() - order.placedAt.getTime()) / (1000 * 60 * 60 * 24);
        const existingRefund = await this.prisma.refundRequest.findFirst({
          where: { orderId: order.id, status: { in: ['processed', 'eligible'] } },
        });

        if (existingRefund) {
          return { eligible: false, reason: 'already_refunded_or_pending' };
        }
        if (ageInDays > 30) {
          return { eligible: false, reason: 'outside_30_day_window', ageInDays: Math.round(ageInDays) };
        }

        // Idempotency key ties this eligibility check to (order, reason) so
        // a retried tool call — or a retried customer message — can't create
        // duplicate refund records for the same underlying request. Status
        // is force-set to 'eligible' on the update branch too, so a request
        // that previously failed processing (see RefundProcessor) can be
        // re-queued instead of getting stuck.
        const idempotencyKey = `refund:${order.id}:${input.reason ?? 'unspecified'}`;
        const refundRequest = await this.prisma.refundRequest.upsert({
          where: { idempotencyKey },
          create: {
            orderId: order.id,
            idempotencyKey,
            status: 'eligible',
            reason: input.reason as string,
            amountCents: order.amountCents,
          },
          update: { status: 'eligible' },
        });

        // Eligibility decides *whether* to refund; actually moving money
        // happens off the request/response path in a background job so a
        // slow payment-processor call never makes the chat reply hang.
        await this.refundQueue.enqueue(refundRequest.id);

        return {
          eligible: true,
          amountCents: refundRequest.amountCents,
          refundRequestId: refundRequest.id,
        };
      }

      case 'pause_subscription': {
        // Executed only after human approval (see EscalationService) — the
        // tool handler itself stays pure so it can be called from either the
        // live chat path (blocked pending approval) or the approval endpoint.
        const resumeAt = new Date(input.resumeAtIso as string);
        const sub = await this.stripe.pauseSubscription(
          input.subscriptionExternalId as string,
          resumeAt,
        );
        return { paused: true, resumeAt: sub.pausedUntil };
      }

      case 'search_knowledge_base': {
        const results = await this.rag.search(input.query as string, 3);
        return { results };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  /** Used by the human approval endpoint to generate a fresh idempotency key when needed. */
  newIdempotencyKey(): string {
    return nanoid();
  }
}
