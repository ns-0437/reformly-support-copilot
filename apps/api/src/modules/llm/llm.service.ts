import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ToolsService, ToolExecutionResult } from '../tools/tools.service';
import { TOOL_DEFINITIONS, ToolName } from '../tools/tool-definitions';
import { FINAL_RESPONSE_TOOL, FinalResponse, FinalResponseSchema } from './schemas/final-response.schema';
import { PrismaService } from '../../prisma.service';

export interface ChatTurnResult {
  final: FinalResponse;
  toolCalls: ToolExecutionResult[];
  structuredOutputRetries: number;
  usage: { inputTokens: number; outputTokens: number };
  provider: 'anthropic';
}

const MAX_TOOL_ITERATIONS = 4;
const MAX_STRUCTURED_OUTPUT_RETRIES = 2;

const SYSTEM_PROMPT = `You are Reformly's customer support agent for a Pilates equipment and home-workout app.
Use the available tools to look up real order/subscription/refund data and to search policy docs before answering — never guess at order status or policy.
pause_subscription is a high-risk billing action: still call it to prepare the change, but always set requestsHumanReview=true and include "billing_change" in riskFlags when you do.
You MUST finish every turn by calling submit_final_response exactly once. Never answer in plain text.
Be honest in selfReportedConfidence: if the customer's request is ambiguous, a tool failed, or you're not fully sure, report a low number rather than guessing confidently.`;

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tools: ToolsService,
    private readonly prisma: PrismaService,
  ) {
    this.model = this.config.get<string>('llm.model') ?? 'claude-sonnet-5';
    this.client = new Anthropic({ apiKey: this.config.get<string>('llm.apiKey') });
  }

  async generateResponse(
    conversationId: string,
    history: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<ChatTurnResult> {
    const startedAt = Date.now();
    const result = await this.runAnthropicLoop(conversationId, history);

    await this.prisma.llmUsageLog.create({
      data: {
        conversationId,
        provider: result.provider,
        model: this.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostUsd: this.estimateCostUsd(result.usage),
        latencyMs: Date.now() - startedAt,
        purpose: 'chat_response',
      },
    });

    return result;
  }

  private estimateCostUsd(usage: { inputTokens: number; outputTokens: number }) {
    // Rough Claude Sonnet-class pricing per 1M tokens; swap for the real rate
    // card if this ships. Kept explicit rather than hidden inside a log line
    // because "cost tracking" is a first-class requirement, not an afterthought.
    const inputRate = 3 / 1_000_000;
    const outputRate = 15 / 1_000_000;
    return usage.inputTokens * inputRate + usage.outputTokens * outputRate;
  }

  // --- Real Anthropic tool-calling loop ---

  private async runAnthropicLoop(
    conversationId: string,
    history: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<ChatTurnResult> {
    const messages: Anthropic.MessageParam[] = history.map((h) => ({
      role: h.role,
      content: h.content,
    }));

    const toolCalls: ToolExecutionResult[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let structuredOutputRetries = 0;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
        tools: [...TOOL_DEFINITIONS, FINAL_RESPONSE_TOOL] as Anthropic.Tool[],
      });

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      messages.push({ role: 'assistant', content: response.content });

      if (toolUseBlocks.length === 0) {
        // Model didn't call a tool at all — nudge it back on protocol instead
        // of silently accepting free-text as the answer.
        messages.push({
          role: 'user',
          content: 'You must call submit_final_response to answer. Please call it now.',
        });
        continue;
      }

      const finalCall = toolUseBlocks.find((b) => b.name === 'submit_final_response');
      const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolUseBlocks) {
        if (block.name === 'submit_final_response') continue;
        const execResult = await this.tools.execute(
          conversationId,
          block.name as ToolName,
          block.input as Record<string, unknown>,
        );
        toolCalls.push(execResult);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(execResult.output),
          is_error: !execResult.success,
        });
      }

      if (finalCall) {
        const parsed = FinalResponseSchema.safeParse(finalCall.input);
        if (parsed.success) {
          return {
            final: parsed.data,
            toolCalls,
            structuredOutputRetries,
            usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            provider: 'anthropic',
          };
        }

        structuredOutputRetries++;
        this.logger.warn(`Malformed submit_final_response (attempt ${structuredOutputRetries}): ${parsed.error.message}`);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: finalCall.id,
          content: `Invalid arguments: ${parsed.error.message}. Fix and call submit_final_response again.`,
          is_error: true,
        });

        if (structuredOutputRetries > MAX_STRUCTURED_OUTPUT_RETRIES) {
          return {
            final: {
              responseText:
                "I'm having trouble putting together a reliable answer — I've flagged this for a teammate to follow up.",
              selfReportedConfidence: 0,
              citedSourceIds: [],
              requestsHumanReview: true,
              riskFlags: ['other'],
            },
            toolCalls,
            structuredOutputRetries,
            usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
            provider: 'anthropic',
          };
        }
      }

      messages.push({ role: 'user', content: toolResultBlocks });
    }

    return {
      final: {
        responseText: "This is taking longer than expected — a teammate will follow up shortly.",
        selfReportedConfidence: 0,
        citedSourceIds: [],
        requestsHumanReview: true,
        riskFlags: ['other'],
      },
      toolCalls,
      structuredOutputRetries,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
      provider: 'anthropic',
    };
  }
}
