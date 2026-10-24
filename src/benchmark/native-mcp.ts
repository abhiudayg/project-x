import { ToolAdapter } from "../adapters/types.js";
import { PolicyEngine } from "../policy.js";

export interface NativeMcpStep {
  readonly tool: string;
  readonly getArgs: (history: Record<string, unknown>) => Record<string, unknown>;
}

export interface NativeMcpResult {
  readonly success: boolean;
  readonly roundTrips: number;
  readonly inputTokensEstimated: number;
  readonly outputTokensEstimated: number;
  readonly executedCalls: readonly string[];
  readonly outputs: Record<string, unknown>;
  readonly error?: Error;
}

export class NativeMcpOrchestrator {
  constructor(
    private readonly adapter: ToolAdapter,
    private readonly policy: PolicyEngine
  ) {}

  async executeSequence(
    steps: readonly NativeMcpStep[],
    basePromptTokens = 800,
    toolDefinitionsTokens = 1200
  ): Promise<NativeMcpResult> {
    const executedCalls: string[] = [];
    const history: Record<string, unknown> = {};

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let roundTrips = 0;

    for (const step of steps) {
      roundTrips++;
      const currentContextTokens =
        basePromptTokens +
        toolDefinitionsTokens +
        Buffer.byteLength(JSON.stringify(history), "utf8") / 4;

      totalInputTokens += Math.round(currentContextTokens);
      totalOutputTokens += 80;

      const toolCap = await this.adapter.getTool(step.tool);
      if (!toolCap) {
        return {
          success: false,
          roundTrips,
          inputTokensEstimated: totalInputTokens,
          outputTokensEstimated: totalOutputTokens,
          executedCalls,
          outputs: history,
          error: new Error(`Tool not found '${step.tool}'`),
        };
      }

      try {
        this.policy.checkToolBoundary(`native-step-${roundTrips}`, toolCap);
        executedCalls.push(step.tool);
        const args = step.getArgs(history);
        const result = await this.adapter.execute(step.tool, args);
        history[step.tool] = result;
      } catch (err) {
        return {
          success: false,
          roundTrips,
          inputTokensEstimated: totalInputTokens,
          outputTokensEstimated: totalOutputTokens,
          executedCalls,
          outputs: history,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    }

    roundTrips++;
    totalInputTokens += Math.round(
      basePromptTokens +
        toolDefinitionsTokens +
        Buffer.byteLength(JSON.stringify(history), "utf8") / 4
    );
    totalOutputTokens += 150;

    return {
      success: true,
      roundTrips,
      inputTokensEstimated: totalInputTokens,
      outputTokensEstimated: totalOutputTokens,
      executedCalls,
      outputs: history,
    };
  }
}
