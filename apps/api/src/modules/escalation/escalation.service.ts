import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ReliabilityAssessment } from '../reliability/reliability.service';

@Injectable()
export class EscalationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(conversationId: string, draftResponse: string, assessment: ReliabilityAssessment) {
    return this.prisma.escalation.create({
      data: {
        conversationId,
        reason: assessment.reason ?? 'low_confidence',
        confidence: assessment.combinedConfidence,
        draftResponse,
        status: 'pending',
      },
    });
  }

  /**
   * Unbounded before this — fine while the queue is empty in a demo, not
   * fine once real volume shows up. `limit` is clamped rather than trusted
   * outright, so a client can't request an arbitrarily large page.
   */
  async listPending(limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    return this.prisma.escalation.findMany({
      where: { status: 'pending' },
      include: { conversation: { include: { customer: true, messages: { orderBy: { createdAt: 'asc' } } } } },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  /**
   * A human reviews the AI's draft and either sends it as-is, edits it, or
   * rejects it outright. Whatever they decide becomes the actual message
   * sent to the customer — the AI never talks to the customer directly on
   * an escalated turn.
   */
  async resolve(
    escalationId: string,
    decision: { action: 'approve' | 'edit' | 'reject'; finalResponse?: string; reviewedBy: string },
  ) {
    const escalation = await this.prisma.escalation.findUnique({ where: { id: escalationId } });
    if (!escalation) throw new NotFoundException('Escalation not found');

    const finalResponse =
      decision.action === 'reject'
        ? "A member of our team will follow up with you shortly."
        : decision.action === 'edit'
        ? decision.finalResponse ?? escalation.draftResponse
        : escalation.draftResponse;

    const updated = await this.prisma.escalation.update({
      where: { id: escalationId },
      data: {
        status: decision.action === 'reject' ? 'rejected' : decision.action === 'edit' ? 'edited' : 'approved',
        finalResponse,
        reviewedBy: decision.reviewedBy,
        resolvedAt: new Date(),
      },
    });

    await this.prisma.message.create({
      data: {
        conversationId: escalation.conversationId,
        role: 'human_agent',
        content: finalResponse,
        metadata: { escalationId, decision: decision.action },
      },
    });

    return updated;
  }
}
