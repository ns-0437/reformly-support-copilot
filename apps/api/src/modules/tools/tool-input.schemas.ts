import { z } from 'zod';
import { ToolName } from './tool-definitions';

/**
 * Runtime validation for tool call inputs, mirroring the input_schema each
 * tool advertises in tool-definitions.ts. Without this, a malformed or
 * missing field (a model hallucination, a mock-loop bug, eventually a
 * genuinely adversarial input) hit a blind `as string` cast in
 * ToolsService.dispatch and either silently misbehaved or threw a
 * confusing error deep inside a Prisma call instead of a clear one here.
 */
const TOOL_INPUT_SCHEMAS = {
  get_order_status: z.object({
    orderExternalId: z.string().min(1),
  }),
  get_subscription_status: z.object({}),
  check_refund_eligibility: z.object({
    orderExternalId: z.string().min(1),
    reason: z.string().min(1),
  }),
  pause_subscription: z.object({
    subscriptionExternalId: z.string().min(1),
    resumeAtIso: z.string().datetime({ message: 'resumeAtIso must be a valid ISO 8601 datetime' }),
  }),
  search_knowledge_base: z.object({
    query: z.string().min(1),
  }),
} satisfies Record<ToolName, z.ZodTypeAny>;

export function validateToolInput(toolName: ToolName, input: Record<string, unknown>): Record<string, unknown> {
  const schema = TOOL_INPUT_SCHEMAS[toolName];
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid input for ${toolName}: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return result.data;
}
