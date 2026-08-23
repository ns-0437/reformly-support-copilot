import { z } from 'zod';

/**
 * Every agent turn must end in exactly this shape. Enforced two ways:
 *  1. The model is asked to call the `submit_final_response` tool (see
 *     final-response.tool.ts) whose input_schema mirrors this Zod schema —
 *     tool-calling is far more reliable than asking for "valid JSON" in prose.
 *  2. The result is re-validated here on our side before it ever reaches a
 *     customer. A malformed/incomplete call is rejected and fed back to the
 *     model as an error, up to MAX_STRUCTURED_OUTPUT_RETRIES times.
 */
export const FinalResponseSchema = z.object({
  responseText: z.string().min(1).max(2000),
  /** Model's own estimate of how confident it is that this answer is correct and complete. */
  selfReportedConfidence: z.number().min(0).max(1),
  /** IDs of KnowledgeDocument rows actually used to ground the answer, if any. */
  citedSourceIds: z.array(z.string()).default([]),
  /** True if the model itself believes this needs a human to check before sending. */
  requestsHumanReview: z.boolean().default(false),
  riskFlags: z
    .array(z.enum(['billing_change', 'refund', 'account_cancellation', 'medical_advice', 'other']))
    .default([]),
});

export type FinalResponse = z.infer<typeof FinalResponseSchema>;

export const FINAL_RESPONSE_TOOL = {
  name: 'submit_final_response',
  description:
    'Submit the final answer to the customer. This MUST be the last tool called in every turn — do not respond in plain text.',
  input_schema: {
    type: 'object',
    properties: {
      responseText: { type: 'string', description: 'The message to show the customer.' },
      selfReportedConfidence: {
        type: 'number',
        description: 'Your honest confidence (0-1) that this response is correct, complete, and safe to send as-is.',
      },
      citedSourceIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'KnowledgeDocument ids returned by search_knowledge_base that support this answer.',
      },
      requestsHumanReview: {
        type: 'boolean',
        description: 'Set true if you believe a human should review this before it is sent.',
      },
      riskFlags: {
        type: 'array',
        items: {
          type: 'string',
          enum: ['billing_change', 'refund', 'account_cancellation', 'medical_advice', 'other'],
        },
      },
    },
    required: ['responseText', 'selfReportedConfidence'],
  },
} as const;
