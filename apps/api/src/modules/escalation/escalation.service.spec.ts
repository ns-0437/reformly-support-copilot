import { ConflictException, NotFoundException } from '@nestjs/common';
import { EscalationService } from './escalation.service';

describe('EscalationService', () => {
  function makeHarness() {
    const prisma = {
      escalation: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      message: { create: jest.fn().mockResolvedValue({}) },
    };
    const service = new EscalationService(prisma as any);
    return { service, prisma };
  }

  it('listPending defaults to a bounded page instead of returning everything', async () => {
    const { service, prisma } = makeHarness();
    prisma.escalation.findMany.mockResolvedValue([]);

    await service.listPending();

    expect(prisma.escalation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('clamps an oversized requested limit rather than trusting it outright', async () => {
    const { service, prisma } = makeHarness();
    prisma.escalation.findMany.mockResolvedValue([]);

    await service.listPending(10000);

    expect(prisma.escalation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });

  it('refuses to resolve an escalation a second time — a double-click or retry must not double-send', async () => {
    const { service, prisma } = makeHarness();
    prisma.escalation.findUnique.mockResolvedValue({ id: 'e1', conversationId: 'c1', status: 'approved' });

    await expect(
      service.resolve('e1', { action: 'approve', reviewedBy: 'agent@reformly.com' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.escalation.update).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when resolving an escalation that does not exist', async () => {
    const { service, prisma } = makeHarness();
    prisma.escalation.findUnique.mockResolvedValue(null);

    await expect(
      service.resolve('missing-id', { action: 'approve', reviewedBy: 'agent@reformly.com' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('approve sends the AI draft unchanged', async () => {
    const { service, prisma } = makeHarness();
    const escalation = { id: 'e1', conversationId: 'c1', status: 'pending', draftResponse: 'Here is the policy answer.' };
    prisma.escalation.findUnique.mockResolvedValue(escalation);
    prisma.escalation.update.mockImplementation(({ data }) => ({ ...escalation, ...data }));

    const result = await service.resolve('e1', { action: 'approve', reviewedBy: 'agent@reformly.com' });

    expect(result.status).toBe('approved');
    expect(result.finalResponse).toBe('Here is the policy answer.');
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'human_agent', content: 'Here is the policy answer.' }) }),
    );
  });

  it('edit sends the human-provided text, not the original draft', async () => {
    const { service, prisma } = makeHarness();
    const escalation = { id: 'e1', conversationId: 'c1', status: 'pending', draftResponse: 'AI draft.' };
    prisma.escalation.findUnique.mockResolvedValue(escalation);
    prisma.escalation.update.mockImplementation(({ data }) => ({ ...escalation, ...data }));

    const result = await service.resolve('e1', {
      action: 'edit',
      finalResponse: 'Corrected human answer.',
      reviewedBy: 'agent@reformly.com',
    });

    expect(result.status).toBe('edited');
    expect(result.finalResponse).toBe('Corrected human answer.');
    expect(result.finalResponse).not.toBe(escalation.draftResponse);
  });

  it('reject discards the AI draft entirely and sends a generic message instead', async () => {
    const { service, prisma } = makeHarness();
    const escalation = { id: 'e1', conversationId: 'c1', status: 'pending', draftResponse: 'Something the AI should not say.' };
    prisma.escalation.findUnique.mockResolvedValue(escalation);
    prisma.escalation.update.mockImplementation(({ data }) => ({ ...escalation, ...data }));

    const result = await service.resolve('e1', { action: 'reject', reviewedBy: 'agent@reformly.com' });

    expect(result.status).toBe('rejected');
    expect(result.finalResponse).not.toBe(escalation.draftResponse);
    expect(result.finalResponse).not.toContain('Something the AI should not say');
  });

  it('an edit action with no finalResponse text falls back to the original draft rather than sending empty', async () => {
    const { service, prisma } = makeHarness();
    const escalation = { id: 'e1', conversationId: 'c1', status: 'pending', draftResponse: 'AI draft.' };
    prisma.escalation.findUnique.mockResolvedValue(escalation);
    prisma.escalation.update.mockImplementation(({ data }) => ({ ...escalation, ...data }));

    const result = await service.resolve('e1', { action: 'edit', reviewedBy: 'agent@reformly.com' });

    expect(result.finalResponse).toBe('AI draft.');
  });
});
