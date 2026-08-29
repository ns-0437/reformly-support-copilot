import { ToolsService } from './tools.service';

describe('ToolsService', () => {
  function makeHarness() {
    const prisma = {
      toolCall: { create: jest.fn().mockResolvedValue({}) },
      refundRequest: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      customer: { findUnique: jest.fn() },
    };
    const shopify = { getOrderByExternalId: jest.fn() };
    const stripe = { pauseSubscription: jest.fn() };
    const rag = { search: jest.fn() };
    const refundQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const service = new ToolsService(prisma as any, shopify as any, stripe as any, rag as any, refundQueue as any);
    return { service, prisma, shopify, stripe, rag, refundQueue };
  }

  const DAY = 24 * 60 * 60 * 1000;

  it('get_order_status returns found:false for an unknown order without throwing', async () => {
    const { service, shopify } = makeHarness();
    shopify.getOrderByExternalId.mockResolvedValue(null);

    const result = await service.execute('conv-1', 'get_order_status', { orderExternalId: 'RFM-999' });

    expect(result.success).toBe(true);
    expect(result.output).toEqual({ found: false });
  });

  it('check_refund_eligibility rejects an order outside the 30-day window', async () => {
    const { service, shopify } = makeHarness();
    shopify.getOrderByExternalId.mockResolvedValue({
      id: 'order-1',
      placedAt: new Date(Date.now() - 45 * DAY),
      amountCents: 10000,
    });

    const result = await service.execute('conv-1', 'check_refund_eligibility', {
      orderExternalId: 'RFM-1',
      reason: 'changed my mind',
    });

    expect((result.output as any).eligible).toBe(false);
    expect((result.output as any).reason).toBe('outside_30_day_window');
  });

  it('check_refund_eligibility rejects an order that already has a processed or pending refund', async () => {
    const { service, shopify, prisma } = makeHarness();
    shopify.getOrderByExternalId.mockResolvedValue({
      id: 'order-1',
      placedAt: new Date(Date.now() - 5 * DAY),
      amountCents: 10000,
    });
    prisma.refundRequest.findFirst.mockResolvedValue({ id: 'existing-refund', status: 'processed' });

    const result = await service.execute('conv-1', 'check_refund_eligibility', {
      orderExternalId: 'RFM-1',
      reason: 'broken',
    });

    expect((result.output as any).eligible).toBe(false);
    expect((result.output as any).reason).toBe('already_refunded_or_pending');
  });

  it('an eligible refund upserts the RefundRequest and enqueues the async job — deciding and moving money stay separate', async () => {
    const { service, shopify, prisma, refundQueue } = makeHarness();
    shopify.getOrderByExternalId.mockResolvedValue({
      id: 'order-1',
      placedAt: new Date(Date.now() - 5 * DAY),
      amountCents: 24900,
    });
    prisma.refundRequest.upsert.mockResolvedValue({ id: 'refund-1', amountCents: 24900 });

    const result = await service.execute('conv-1', 'check_refund_eligibility', {
      orderExternalId: 'RFM-1',
      reason: 'arrived broken',
    });

    expect((result.output as any).eligible).toBe(true);
    expect(prisma.refundRequest.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'eligible' }), update: { status: 'eligible' } }),
    );
    expect(refundQueue.enqueue).toHaveBeenCalledWith('refund-1');
  });

  it('wraps a thrown error as a failed ToolExecutionResult instead of propagating it', async () => {
    const { service, shopify } = makeHarness();
    shopify.getOrderByExternalId.mockRejectedValue(new Error('upstream 502'));

    const result = await service.execute('conv-1', 'get_order_status', { orderExternalId: 'RFM-1' });

    expect(result.success).toBe(false);
    expect((result.output as any).error).toBe('upstream 502');
  });

  it('flags pause_subscription as requiring approval', async () => {
    const { service, stripe } = makeHarness();
    stripe.pauseSubscription.mockResolvedValue({ pausedUntil: new Date('2026-01-01') });

    const result = await service.execute('conv-1', 'pause_subscription', {
      subscriptionExternalId: 'sub_1',
      resumeAtIso: '2026-01-01T00:00:00.000Z',
    });

    expect(result.requiresApproval).toBe(true);
  });
});
