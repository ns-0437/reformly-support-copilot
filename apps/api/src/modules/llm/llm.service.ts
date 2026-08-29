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
  provider: 'anthropic' | 'mock';
}

interface OrderStatusOutput {
  status: string;
  estimatedShip?: string | null;
  deliveredAt?: string | null;
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
  private readonly client: Anthropic | null;
  private readonly mock: boolean;
  private readonly model: string;

  constructor(
    private readonly config: ConfigService,
    private readonly tools: ToolsService,
    private readonly prisma: PrismaService,
  ) {
    this.mock = this.config.get<boolean>('llm.mock') ?? true;
    this.model = this.config.get<string>('llm.model') ?? 'claude-sonnet-5';
    this.client = this.mock
      ? null
      : new Anthropic({ apiKey: this.config.get<string>('llm.apiKey') });
  }

  async generateResponse(
    conversationId: string,
    history: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<ChatTurnResult> {
    const startedAt = Date.now();
    const result = this.mock
      ? await this.runMockLoop(conversationId, history)
      : await this.runAnthropicLoop(conversationId, history);

    await this.prisma.llmUsageLog.create({
      data: {
        conversationId,
        provider: result.provider,
        model: this.mock ? 'mock-rule-engine' : this.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostUsd: this.estimateCostUsd(result.usage, result.provider),
        latencyMs: Date.now() - startedAt,
        purpose: 'chat_response',
      },
    });

    return result;
  }

  /**
   * The extra date clause only makes sense for a subset of statuses — a
   * refunded or delivered order showing a stale "estimated ship date"
   * reads as broken, not just unhelpful.
   */
  private formatOrderStatus(orderId: string, output: OrderStatusOutput): string {
    const base = `Order ${orderId} is currently "${output.status}".`;
    if (output.status === 'pending' && output.estimatedShip) {
      return `${base} Estimated ship date: ${new Date(output.estimatedShip).toDateString()}.`;
    }
    if (output.status === 'delivered' && output.deliveredAt) {
      return `${base} Delivered on ${new Date(output.deliveredAt).toDateString()}.`;
    }
    return base;
  }

  private estimateCostUsd(usage: { inputTokens: number; outputTokens: number }, provider: string) {
    if (provider === 'mock') return 0;
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
    if (!this.client) throw new Error('Anthropic client not configured');

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

  // --- Deterministic mock loop (no API key required) ---
  //
  // Runs the exact same ToolsService/RagService code paths as the real loop —
  // only the "which tool to call" decision is rule-based instead of model-driven.
  // This keeps the reliability/escalation/BullMQ/webhook machinery fully
  // exercisable offline; flip MOCK_LLM=false + set ANTHROPIC_API_KEY to swap
  // in real Claude without touching any other module.

  private async runMockLoop(
    conversationId: string,
    history: { role: 'user' | 'assistant'; content: string }[],
  ): Promise<ChatTurnResult> {
    const latestMessage = [...history].reverse().find((h) => h.role === 'user')?.content ?? '';
    const toolCalls: ToolExecutionResult[] = [];

    const orderIdMatch = latestMessage.match(/RFM-\d+/i);
    const emailMatch = latestMessage.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const lower = latestMessage.toLowerCase();

    let final: FinalResponse;

    if (lower.includes('refund') && orderIdMatch) {
      const result = await this.tools.execute(conversationId, 'check_refund_eligibility', {
        orderExternalId: orderIdMatch[0].toUpperCase(),
        reason: latestMessage,
      });
      toolCalls.push(result);
      const eligible = (result.output as any)?.eligible;
      final = {
        responseText: eligible
          ? `Good news — order ${orderIdMatch[0].toUpperCase()} is eligible for a refund. I've started the process; you'll see it reflected within 5-7 business days.`
          : `I checked order ${orderIdMatch[0].toUpperCase()} and it doesn't currently qualify for an automatic refund (${(result.output as any)?.reason ?? 'unknown reason'}). I'm looping in a teammate to take a closer look.`,
        selfReportedConfidence: result.success ? (eligible ? 0.88 : 0.7) : 0.25,
        citedSourceIds: [],
        requestsHumanReview: !result.success || !eligible,
        riskFlags: ['refund'],
      };
    } else if ((lower.includes('pause') || lower.includes('cancel')) && lower.includes('subscription')) {
      final = {
        responseText:
          "I can help pause your subscription. Since this changes your billing, I'm getting a teammate to confirm the details with you before it's applied.",
        selfReportedConfidence: 0.55,
        citedSourceIds: [],
        requestsHumanReview: true,
        riskFlags: ['billing_change', 'account_cancellation'],
      };
    } else if (orderIdMatch) {
      const result = await this.tools.execute(conversationId, 'get_order_status', {
        orderExternalId: orderIdMatch[0].toUpperCase(),
      });
      toolCalls.push(result);
      const found = (result.output as any)?.found;
      final = {
        responseText: found
          ? this.formatOrderStatus(orderIdMatch[0].toUpperCase(), result.output as OrderStatusOutput)
          : `I couldn't find order ${orderIdMatch[0].toUpperCase()} — could you double check the order number?`,
        selfReportedConfidence: result.success && found ? 0.9 : 0.4,
        citedSourceIds: [],
        requestsHumanReview: !result.success,
        riskFlags: [],
      };
    } else if (emailMatch) {
      const result = await this.tools.execute(conversationId, 'get_subscription_status', {
        customerEmail: emailMatch[0],
      });
      toolCalls.push(result);
      const found = (result.output as any)?.found;
      final = {
        responseText: found
          ? `I found your account. Your subscription status: ${JSON.stringify((result.output as any).subscriptions.map((s: any) => ({ plan: s.plan, status: s.status })))}.`
          : `I couldn't find an account for ${emailMatch[0]} — could you confirm the email on file?`,
        selfReportedConfidence: result.success && found ? 0.85 : 0.4,
        citedSourceIds: [],
        requestsHumanReview: !result.success,
        riskFlags: [],
      };
    } else {
      const searchResult = await this.tools.execute(conversationId, 'search_knowledge_base', {
        query: latestMessage,
      });
      toolCalls.push(searchResult);
      const results = ((searchResult.output as any)?.results ?? []) as { id: string; title: string; content: string; similarity: number }[];
      const top = results[0];
      // Calibrated against the actual seeded KB content: genuine topic
      // matches score ~0.16-0.53 similarity, off-topic/adversarial input
      // scores ~0.05-0.08 (see docs/CASE-STUDY.md for the numbers). 0.12
      // sits with margin on both sides of that gap.
      const confident = top && top.similarity > 0.12;
      final = {
        responseText: confident
          ? `${top.content}`
          : "I'm not fully sure about that one — let me get a teammate to confirm and get back to you.",
        selfReportedConfidence: confident ? Math.min(0.9, 0.5 + top.similarity) : 0.35,
        citedSourceIds: confident ? [top.id] : [],
        requestsHumanReview: !confident,
        riskFlags: [],
      };
    }

    return {
      final,
      toolCalls,
      structuredOutputRetries: 0,
      usage: { inputTokens: latestMessage.length, outputTokens: final.responseText.length },
      provider: 'mock',
    };
  }
}
