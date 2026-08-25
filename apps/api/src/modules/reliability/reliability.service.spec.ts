import { ConfigService } from '@nestjs/config';
import { ReliabilityService } from './reliability.service';
import { ToolExecutionResult } from '../tools/tools.service';
import { FinalResponse } from '../llm/schemas/final-response.schema';

function makeFinal(overrides: Partial<FinalResponse> = {}): FinalResponse {
  return {
    responseText: 'test response',
    selfReportedConfidence: 0.9,
    citedSourceIds: [],
    requestsHumanReview: false,
    riskFlags: [],
    ...overrides,
  };
}

function makeToolCall(overrides: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return {
    toolName: 'get_order_status',
    success: true,
    output: {},
    latencyMs: 10,
    retries: 0,
    requiresApproval: false,
    ...overrides,
  };
}

describe('ReliabilityService', () => {
  function makeService(overrides: Record<string, unknown> = {}) {
    const config = {
      get: (key: string) =>
        ({
          'reliability.escalationThreshold': 0.62,
          'reliability.autoEscalateHighRiskTools': true,
          ...overrides,
        })[key],
    } as unknown as ConfigService;
    return new ReliabilityService(config);
  }

  it('does not escalate a high-confidence answer backed by successful tool calls', () => {
    const service = makeService();
    const result = service.assess(makeFinal({ selfReportedConfidence: 0.95 }), [makeToolCall()]);
    expect(result.shouldEscalate).toBe(false);
    expect(result.combinedConfidence).toBeCloseTo(0.97, 5);
  });

  it('escalates when confidence is high but the only tool call failed', () => {
    const service = makeService();
    const result = service.assess(
      makeFinal({ selfReportedConfidence: 0.9 }),
      [makeToolCall({ success: false })],
    );
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toBe('tool_failure');
    expect(result.combinedConfidence).toBe(0);
  });

  it('always escalates a high-risk tool regardless of confidence', () => {
    const service = makeService();
    const result = service.assess(
      makeFinal({ selfReportedConfidence: 0.99 }),
      [makeToolCall({ toolName: 'pause_subscription' as any })],
    );
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toBe('high_risk_tool');
  });

  it('escalates when the model itself requests human review', () => {
    const service = makeService();
    const result = service.assess(makeFinal({ requestsHumanReview: true, selfReportedConfidence: 0.9 }), []);
    expect(result.shouldEscalate).toBe(true);
    expect(result.reason).toBe('explicit_request');
  });

  it('escalates below the configured threshold on blended low confidence', () => {
    const service = makeService({ 'reliability.escalationThreshold': 0.62 });
    const result = service.assess(makeFinal({ selfReportedConfidence: 0.5 }), [makeToolCall()]);
    // 0.6 * 0.5 + 0.4 * 1 = 0.7, above threshold -> should NOT escalate
    expect(result.combinedConfidence).toBeCloseTo(0.7, 5);
    expect(result.shouldEscalate).toBe(false);
  });
});
