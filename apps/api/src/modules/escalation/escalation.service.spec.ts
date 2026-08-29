import { NotFoundException } from '@nestjs/common';
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

  it('throws NotFoundException when resolving an escalation that does not exist', async () => {
    const { service, prisma } = makeHarness();
    prisma.escalation.findUnique.mockResolvedValue(null);

    await expect(
      service.resolve('missing-id', { action: 'approve', reviewedBy: 'agent@reformly.com' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('approve sends the AI draft unchanged', async () => {
    const { service, prisma } = makeHarness();
    const escalation = { id: 'e1', conversationId: 'c1', draftResponse: 'Here is the policy answer.' };
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
    const escalation = { id: 'e1', conversationId: 'c1', draftResponse: 'AI draft.' };
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
    const escalation = { id: 'e1', conversationId: 'c1', draftResponse: 'Something the AI should not say.' };
    prisma.escalation.findUnique.mockResolvedValue(escalation);
    prisma.escalation.update.mockImplementation(({ data }) => ({ ...escalation, ...data }));

    const result = await service.resolve('e1', { action: 'reject', reviewedBy: 'agent@reformly.com' });

    expect(result.status).toBe('rejected');
    expect(result.finalResponse).not.toBe(escalation.draftResponse);
    expect(result.finalResponse).not.toContain('Something the AI should not say');
  });

  it('an edit action with no finalResponse text falls back to the original draft rather than sending empty', async () => {
    const { service, prisma } = makeHarness();
    const escalation = { id: 'e1', conversationId: 'c1', draftResponse: 'AI draft.' };
    prisma.escalation.findUnique.mockResolvedValue(escalation);
    prisma.escalation.update.mockImplementation(({ data }) => ({ ...escalation, ...data }));

    const result = await service.resolve('e1', { action: 'edit', reviewedBy: 'agent@reformly.com' });

    expect(result.finalResponse).toBe('AI draft.');
  });
});
