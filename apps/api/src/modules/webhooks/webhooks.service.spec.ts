import { WebhooksService } from './webhooks.service';

describe('WebhooksService', () => {
  function makeHarness() {
    const prisma = {
      webhookEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'evt-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
      subscription: { update: jest.fn().mockResolvedValue({}) },
    };
    const service = new WebhooksService(prisma as any);
    return { service, prisma };
  }

  it('ignores a duplicate delivery of the same provider event id without reapplying the side effect', async () => {
    const { service, prisma } = makeHarness();
    prisma.webhookEvent.findUnique.mockResolvedValue({ id: 'evt-1', status: 'processed' });

    const result = await service.handle({
      provider: 'shopify',
      externalEventId: 'evt_123',
      eventType: 'order.status_changed',
      payload: { orderExternalId: 'RFM-1', status: 'shipped' },
    });

    expect(result.status).toBe('duplicate_ignored');
    expect(prisma.webhookEvent.create).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('applies the order status update for a new shopify event and marks it processed', async () => {
    const { service, prisma } = makeHarness();

    const result = await service.handle({
      provider: 'shopify',
      externalEventId: 'evt_new',
      eventType: 'order.status_changed',
      payload: { orderExternalId: 'RFM-1', status: 'delivered' },
    });

    expect(result.status).toBe('processed');
    expect(prisma.order.update).toHaveBeenCalledWith({
      where: { externalId: 'RFM-1' },
      data: { status: 'delivered' },
    });
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'processed' }) }),
    );
  });

  it('marks the event failed, but still recorded, when the side effect throws', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.update.mockRejectedValue(new Error('order not found'));

    const result = await service.handle({
      provider: 'shopify',
      externalEventId: 'evt_bad',
      eventType: 'order.status_changed',
      payload: { orderExternalId: 'RFM-does-not-exist', status: 'delivered' },
    });

    expect(result.status).toBe('failed');
    expect(prisma.webhookEvent.create).toHaveBeenCalled();
    expect(prisma.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'failed' } }),
    );
  });

  it('stores but does not crash on an event type with no registered handler', async () => {
    const { service, prisma } = makeHarness();

    const result = await service.handle({
      provider: 'stripe',
      externalEventId: 'evt_unknown',
      eventType: 'invoice.paid',
      payload: {},
    });

    expect(result.status).toBe('processed');
    expect(prisma.subscription.update).not.toHaveBeenCalled();
  });
});
