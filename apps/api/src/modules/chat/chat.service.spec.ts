import { NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { FinalResponse } from '../llm/schemas/final-response.schema';

function makeFinal(overrides: Partial<FinalResponse> = {}): FinalResponse {
  return {
    responseText: 'Here is your answer.',
    selfReportedConfidence: 0.9,
    citedSourceIds: [],
    requestsHumanReview: false,
    riskFlags: [],
    ...overrides,
  };
}

describe('ChatService', () => {
  function makeHarness() {
    const customer = { id: 'cust-1', email: 'jane.doe@example.com' };
    const conversation = { id: 'conv-1', customerId: customer.id };

    const prisma = {
      customer: { findUnique: jest.fn().mockResolvedValue(customer) },
      conversation: {
        findUnique: jest.fn().mockResolvedValue(conversation),
        create: jest.fn().mockResolvedValue(conversation),
        update: jest.fn().mockResolvedValue(conversation),
      },
      message: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const llm = { generateResponse: jest.fn() };
    const reliability = { assess: jest.fn() };
    const escalation = { create: jest.fn().mockResolvedValue({ id: 'esc-1' }) };

    const service = new ChatService(prisma as any, llm as any, reliability as any, escalation as any);
    return { service, prisma, llm, reliability, escalation, customer, conversation };
  }

  it('throws NotFoundException for an unknown customer email before touching the LLM', async () => {
    const { service, prisma, llm } = makeHarness();
    prisma.customer.findUnique.mockResolvedValue(null);

    await expect(
      service.handleMessage({ customerEmail: 'nobody@example.com', message: 'hi' } as any),
    ).rejects.toThrow(NotFoundException);
    expect(llm.generateResponse).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for a conversationId that does not exist', async () => {
    const { service, prisma } = makeHarness();
    prisma.conversation.findUnique.mockResolvedValue(null);

    await expect(
      service.handleMessage({
        customerEmail: 'jane.doe@example.com',
        conversationId: 'missing-conv',
        message: 'hi',
      } as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('caps history fetch to the most recent messages instead of loading the whole conversation', async () => {
    const { service, prisma, llm, reliability } = makeHarness();
    llm.generateResponse.mockResolvedValue({ final: makeFinal(), toolCalls: [] });
    reliability.assess.mockReturnValue({ shouldEscalate: false, combinedConfidence: 0.9, reason: null });

    await service.handleMessage({
      customerEmail: 'jane.doe@example.com',
      conversationId: 'conv-1',
      message: 'hi',
    } as any);

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' }, take: 20 }),
    );
  });

  it('passes history to the LLM in chronological order despite fetching newest-first', async () => {
    const { service, prisma, llm, reliability } = makeHarness();
    // findMany with orderBy desc + take returns newest-first — this proves
    // it gets reversed back to oldest-first before the LLM sees it, not
    // left in fetch order (which would scramble the conversation for the
    // model to reason about).
    prisma.message.findMany.mockResolvedValue([
      { role: 'agent', content: 'second reply' },
      { role: 'customer', content: 'second question' },
      { role: 'agent', content: 'first reply' },
      { role: 'customer', content: 'first question' },
    ]);
    llm.generateResponse.mockResolvedValue({ final: makeFinal(), toolCalls: [] });
    reliability.assess.mockReturnValue({ shouldEscalate: false, combinedConfidence: 0.9, reason: null });

    await service.handleMessage({
      customerEmail: 'jane.doe@example.com',
      conversationId: 'conv-1',
      message: 'third question',
    } as any);

    const [, history] = llm.generateResponse.mock.calls[0];
    expect(history.map((h: any) => h.content)).toEqual([
      'first question',
      'first reply',
      'second question',
      'second reply',
    ]);
  });

  it('creates a fresh conversation when no conversationId is given', async () => {
    const { service, prisma, llm, reliability } = makeHarness();
    llm.generateResponse.mockResolvedValue({ final: makeFinal(), toolCalls: [] });
    reliability.assess.mockReturnValue({ shouldEscalate: false, combinedConfidence: 0.9, reason: null });

    await service.handleMessage({ customerEmail: 'jane.doe@example.com', message: 'hi' } as any);

    expect(prisma.conversation.create).toHaveBeenCalledWith({ data: { customerId: 'cust-1' } });
    expect(prisma.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('returns an answered turn and stores the agent message when confidence clears the bar', async () => {
    const { service, llm, reliability, prisma, escalation } = makeHarness();
    llm.generateResponse.mockResolvedValue({
      final: makeFinal({ responseText: 'Your order shipped yesterday.' }),
      toolCalls: [{ toolName: 'get_order_status', success: true }],
    });
    reliability.assess.mockReturnValue({ shouldEscalate: false, combinedConfidence: 0.88, reason: null });

    const result = await service.handleMessage({
      customerEmail: 'jane.doe@example.com',
      message: 'where is my order',
    } as any);

    expect(result).toEqual({
      conversationId: 'conv-1',
      status: 'answered',
      message: 'Your order shipped yesterday.',
      confidence: 0.88,
    });
    expect(escalation.create).not.toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'agent', content: 'Your order shipped yesterday.' }) }),
    );
  });

  it('escalates instead of answering when reliability says to, and never leaks the draft as the customer-facing message', async () => {
    const { service, llm, reliability, prisma, escalation } = makeHarness();
    const draft = 'I think the order was cancelled but I am not sure.';
    llm.generateResponse.mockResolvedValue({
      final: makeFinal({ responseText: draft, selfReportedConfidence: 0.4 }),
      toolCalls: [],
    });
    reliability.assess.mockReturnValue({ shouldEscalate: true, combinedConfidence: 0.4, reason: 'low_confidence' });

    const result = await service.handleMessage({
      customerEmail: 'jane.doe@example.com',
      message: 'where is my order',
    } as any);

    expect(result.status).toBe('escalated');
    expect(result.message).not.toContain(draft);
    expect(result.escalationId).toBe('esc-1');
    expect(escalation.create).toHaveBeenCalledWith('conv-1', draft, expect.objectContaining({ shouldEscalate: true }));
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { status: 'escalated' },
    });
  });
});
