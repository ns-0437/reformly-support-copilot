import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class ObservabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const [usageAgg, totalConversations, escalationCounts, toolStats] = await Promise.all([
      this.prisma.llmUsageLog.aggregate({
        _sum: { estimatedCostUsd: true, inputTokens: true, outputTokens: true },
        _count: true,
      }),
      this.prisma.conversation.count(),
      this.prisma.escalation.groupBy({ by: ['status'], _count: true }),
      this.prisma.toolCall.groupBy({ by: ['toolName', 'success'], _count: true }),
    ]);

    const escalatedConversations = await this.prisma.conversation.count({ where: { status: 'escalated' } });

    return {
      totalConversations,
      escalationRate: totalConversations === 0 ? 0 : escalatedConversations / totalConversations,
      escalationsByStatus: escalationCounts.map((e) => ({ status: e.status, count: e._count })),
      llmUsage: {
        totalCalls: usageAgg._count,
        totalCostUsd: usageAgg._sum.estimatedCostUsd ?? 0,
        totalInputTokens: usageAgg._sum.inputTokens ?? 0,
        totalOutputTokens: usageAgg._sum.outputTokens ?? 0,
      },
      toolReliability: toolStats.map((t) => ({
        tool: t.toolName,
        success: t.success,
        count: t._count,
      })),
    };
  }
}
