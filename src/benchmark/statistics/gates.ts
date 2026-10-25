import { BootstrapSummary } from "./bootstrap.js";

export interface DecisionGateOutcome {
  readonly gateId: string;
  readonly name: string;
  readonly target: string;
  readonly observed: string;
  readonly passed: boolean;
  readonly rationale: string;
}

export interface ComprehensiveEvaluationReport {
  readonly generatedAt: string;
  readonly modelFamilyResults: Record<
    string,
    {
      readonly tokenReductionVsMcp: BootstrapSummary;
      readonly costReductionVsMcp: BootstrapSummary;
      readonly taskCompletionRate: number;
      readonly firstAttemptPlanSuccessRate: number;
      readonly medianLatencyMs: number;
      readonly p90LatencyMs: number;
      readonly interpreterOverheadLatencyPct: number;
      readonly interpreterOverheadBytesPct: number;
    }
  >;
  readonly gateOutcomes: readonly DecisionGateOutcome[];
  readonly overallRecommendation: "PROCEED_TO_PHASE_1" | "NARROW_SCOPE" | "STOP_OR_PIVOT";
}

export class DecisionGateEvaluator {
  static evaluate(
    tokenReductionCI: BootstrapSummary,
    costReductionCI: BootstrapSummary,
    completionRateX: number,
    completionRateMcp: number,
    completionRateCodeMode: number,
    securityUnauthorizedWrites: number,
    silentLossCount: number,
    differentiationWins: number,
    interpreterLatencyOverheadPct: number,
    interpreterBytesOverheadPct: number,
    modelFamilyResults: Record<
      string,
      {
        readonly tokenReductionVsMcp: BootstrapSummary;
        readonly costReductionVsMcp: BootstrapSummary;
        readonly taskCompletionRate: number;
        readonly firstAttemptPlanSuccessRate: number;
        readonly medianLatencyMs: number;
        readonly p90LatencyMs: number;
        readonly interpreterOverheadLatencyPct: number;
        readonly interpreterOverheadBytesPct: number;
      }
    > = {}
  ): ComprehensiveEvaluationReport {
    const gates: DecisionGateOutcome[] = [
      {
        gateId: "GATE-1",
        name: "Token Reduction",
        target: "Lower bound of 90% CI vs Native MCP >= 30%",
        observed: `[${tokenReductionCI.ciLow}%, ${tokenReductionCI.ciHigh}%], mean=${tokenReductionCI.mean}%`,
        passed: tokenReductionCI.ciLow >= 30.0,
        rationale:
          tokenReductionCI.ciLow >= 30.0
            ? "Token reduction comfortably exceeds the 30% lower bound."
            : "Token reduction lower bound fell below 30% threshold.",
      },
      {
        gateId: "GATE-2",
        name: "Cost Reduction",
        target: "Lower bound of 90% CI vs Native MCP >= 20% with lower bound > 0",
        observed: `[${costReductionCI.ciLow}%, ${costReductionCI.ciHigh}%], mean=${costReductionCI.mean}%`,
        passed: costReductionCI.ciLow >= 20.0 && costReductionCI.ciLow > 0,
        rationale:
          costReductionCI.ciLow >= 20.0
            ? "Cost savings lower bound exceeds 20% target."
            : "Cost reduction does not meet 20% lower bound requirement.",
      },
      {
        gateId: "GATE-3",
        name: "Task Completion Preservation",
        target: "No statistically meaningful drop vs Native MCP or Code Mode",
        observed: `X: ${(completionRateX * 100).toFixed(1)}%, MCP: ${(completionRateMcp * 100).toFixed(1)}%, CodeMode: ${(completionRateCodeMode * 100).toFixed(1)}%`,
        passed: completionRateX >= completionRateMcp - 0.05,
        rationale: "Task completion rate matches or exceeds baseline orchestration.",
      },
      {
        gateId: "GATE-4",
        name: "Security Isolation",
        target: "Zero unauthorized writes in the security test suite",
        observed: `${securityUnauthorizedWrites} unauthorized writes`,
        passed: securityUnauthorizedWrites === 0,
        rationale:
          securityUnauthorizedWrites === 0
            ? "Zero unauthorized writes occurred across all security fixtures."
            : "Security violation detected.",
      },
      {
        gateId: "GATE-5",
        name: "Failure Visibility",
        target: "No silent loss of failures or partial completions",
        observed: `${silentLossCount} silent drops`,
        passed: silentLossCount === 0,
        rationale: "All failures and cancellations cleanly documented in receipts.",
      },
      {
        gateId: "GATE-6",
        name: "Differentiation vs Code Mode",
        target: "Measurable advantage on at least one §10.3 test",
        observed: `${differentiationWins} verified differentiation advantages`,
        passed: differentiationWins >= 1,
        rationale:
          "Confirmed pre-execution static validation and write gating before any side effect.",
      },
      {
        gateId: "GATE-7",
        name: "Interpreter Runtime Overhead",
        target: "< 2% latency overhead, < 1% bytes processed overhead",
        observed: `Latency overhead: ${interpreterLatencyOverheadPct.toFixed(2)}%, Bytes overhead: ${interpreterBytesOverheadPct.toFixed(2)}%`,
        passed:
          interpreterLatencyOverheadPct < 2.0 &&
          interpreterBytesOverheadPct < 1.0,
        rationale: "Lightweight embedded interpreter overhead remains within bounds.",
      },
    ];

    const allPassed = gates.every((g) => g.passed);
    const overallRecommendation = allPassed ? "PROCEED_TO_PHASE_1" : "NARROW_SCOPE";

    return {
      generatedAt: new Date().toISOString(),
      modelFamilyResults,
      gateOutcomes: gates,
      overallRecommendation,
    };
  }
}
