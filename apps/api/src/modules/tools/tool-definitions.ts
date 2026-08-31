/**
 * Anthropic tool-calling schemas. Kept separate from the execution logic
 * (tools.service.ts) so the LLM-facing contract and the implementation can
 * change independently — e.g. swapping the Shopify mirror for the real API
 * later shouldn't touch this file at all.
 */
export const TOOL_DEFINITIONS = [
  {
    name: 'get_order_status',
    description:
      "Look up a customer's order status, shipping estimate, and delivery date by order id.",
    input_schema: {
      type: 'object',
      properties: {
        orderExternalId: { type: 'string', description: 'The Shopify-style order id, e.g. RFM-10234' },
      },
      required: ['orderExternalId'],
    },
  },
  {
    name: 'get_subscription_status',
    description:
      "Look up the current customer's own app subscription status (active/paused/cancelled), plan, and renewal date. Always resolves to whoever is authenticated on this conversation — there is no way to look up a different customer's subscription.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'check_refund_eligibility',
    description:
      'Check whether an order qualifies for a refund under Reformly policy (within 30 days, not already refunded) without actually issuing one.',
    input_schema: {
      type: 'object',
      properties: {
        orderExternalId: { type: 'string' },
        reason: { type: 'string', description: 'Customer-stated reason for the refund request' },
      },
      required: ['orderExternalId', 'reason'],
    },
  },
  {
    name: 'pause_subscription',
    description:
      'Pause a customer subscription until a given date. HIGH RISK: this mutates billing state and is always routed to human approval before being applied, regardless of confidence.',
    input_schema: {
      type: 'object',
      properties: {
        subscriptionExternalId: { type: 'string' },
        resumeAtIso: { type: 'string', description: 'ISO 8601 date to resume billing' },
      },
      required: ['subscriptionExternalId', 'resumeAtIso'],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'Semantic search over Reformly policy and product docs (shipping, returns, board sizing/assembly, subscription terms) to ground an answer in the actual written policy.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
] as const;

export const HIGH_RISK_TOOLS = new Set(['pause_subscription']);

export type ToolName = (typeof TOOL_DEFINITIONS)[number]['name'];
