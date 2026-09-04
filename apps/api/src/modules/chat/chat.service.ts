import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LlmService } from '../llm/llm.service';
import { ReliabilityService } from '../reliability/reliability.service';
import { EscalationService } from '../escalation/escalation.service';
import { SendMessageDto } from './dto/send-message.dto';

export interface ChatTurnResponse {
  conversationId: string;
  status: 'answered' | 'escalated';
  message: string;
  confidence: number;
  escalationId?: string;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly reliability: ReliabilityService,
    private readonly escalation: EscalationService,
  ) {}

  async handleMessage(dto: SendMessageDto): Promise<ChatTurnResponse> {
    const customer = await this.prisma.customer.findUnique({ where: { email: dto.customerEmail.toLowerCase() } });
    if (!customer) throw new NotFoundException(`No customer with email ${dto.customerEmail}`);

    let conversation;
    if (dto.conversationId) {
      conversation = await this.prisma.conversation.findUnique({ where: { id: dto.conversationId } });
      if (!conversation) throw new NotFoundException(`No conversation with id ${dto.conversationId}`);
    } else {
      conversation = await this.prisma.conversation.create({ data: { customerId: customer.id } });
    }

    await this.prisma.message.create({
      data: { conversationId: conversation.id, role: 'customer', content: dto.message },
    });

    // Unbounded before this — every turn loaded the entire conversation
    // history and handed all of it to the LLM as context, so both the query
    // and the token cost grew linearly with conversation length forever.
    // Fetched newest-first with a cap, then reversed back to chronological
    // order for the model.
    const MAX_HISTORY_MESSAGES = 20;
    const recentMessages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    });
    const priorMessages = recentMessages.reverse();

    const history = priorMessages
      .filter((m) => m.role === 'customer' || m.role === 'agent')
      .map((m) => ({ role: (m.role === 'customer' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.content }));

    const turn = await this.llm.generateResponse(conversation.id, history);
    const assessment = this.reliability.assess(turn.final, turn.toolCalls);

    if (assessment.shouldEscalate) {
      const escalationRecord = await this.escalation.create(conversation.id, turn.final.responseText, assessment);
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { status: 'escalated' } });
      await this.prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: 'agent',
          content: '[held for human review]',
          metadata: {
            draftResponse: turn.final.responseText,
            confidence: assessment.combinedConfidence,
            reason: assessment.reason,
            toolCalls: turn.toolCalls.map((t) => ({ tool: t.toolName, success: t.success })),
          } as any,
        },
      });

      return {
        conversationId: conversation.id,
        status: 'escalated',
        message: 'A teammate is reviewing this and will respond shortly.',
        confidence: assessment.combinedConfidence,
        escalationId: escalationRecord.id,
      };
    }

    await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: 'agent',
        content: turn.final.responseText,
        metadata: {
          confidence: assessment.combinedConfidence,
          citedSourceIds: turn.final.citedSourceIds,
          toolCalls: turn.toolCalls.map((t) => ({ tool: t.toolName, success: t.success })),
        } as any,
      },
    });

    return {
      conversationId: conversation.id,
      status: 'answered',
      message: turn.final.responseText,
      confidence: assessment.combinedConfidence,
    };
  }
}
