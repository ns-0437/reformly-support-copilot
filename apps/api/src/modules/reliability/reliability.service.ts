import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FinalResponse } from '../llm/schemas/final-response.schema';
import { ToolExecutionResult } from '../tools/tools.service';
import { HIGH_RISK_TOOLS } from '../tools/tool-definitions';

export interface ReliabilityAssessment {
  /** Combined 0-1 score — NOT just the model's self-report. */
  combinedConfidence: number;
  shouldEscalate: boolean;
  reason: 'low_confidence' | 'high_risk_tool' | 'tool_failure' | 'explicit_request' | null;
}

/**
 * A model saying "I'm 95% confident" is not itself trustworthy — it's one
 * signal among several. This blends the model's self-report with objective
 * signals we can actually verify (did the tools it relied on succeed? did it
 * touch a high-risk tool? did it ask for review itself?) into one score, and
 * applies the escalation policy Reformly would actually want in production.
 */
@Injectable()
export class ReliabilityService {
  private readonly threshold: number;
  private readonly autoEscalateHighRisk: boolean;

  constructor(private readonly config: ConfigService) {
    this.threshold = this.config.get<number>('reliability.escalationThreshold') ?? 0.62;
    this.autoEscalateHighRisk = this.config.get<boolean>('reliability.autoEscalateHighRiskTools') ?? true;
  }

  assess(final: FinalResponse, toolCalls: ToolExecutionResult[]): ReliabilityAssessment {
    if (this.autoEscalateHighRisk && toolCalls.some((t) => HIGH_RISK_TOOLS.has(t.toolName as any))) {
      return { combinedConfidence: final.selfReportedConfidence, shouldEscalate: true, reason: 'high_risk_tool' };
    }

    if (toolCalls.length > 0 && toolCalls.every((t) => !t.success)) {
      return { combinedConfidence: 0, shouldEscalate: true, reason: 'tool_failure' };
    }

    if (final.requestsHumanReview) {
      return { combinedConfidence: final.selfReportedConfidence, shouldEscalate: true, reason: 'explicit_request' };
    }

    const toolSuccessRate =
      toolCalls.length === 0 ? 1 : toolCalls.filter((t) => t.success).length / toolCalls.length;

    // Weighted blend: the model's own estimate matters, but a failed/partial
    // tool chain drags the combined score down even if the model sounded sure.
    const combinedConfidence =
      0.6 * final.selfReportedConfidence + 0.4 * toolSuccessRate;

    return {
      combinedConfidence,
      shouldEscalate: combinedConfidence < this.threshold,
      reason: combinedConfidence < this.threshold ? 'low_confidence' : null,
    };
  }
}
