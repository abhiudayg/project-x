export interface BenchmarkTask {
  readonly id: string;
  readonly category:
    | "independent_read"
    | "dependent_api"
    | "large_result_aggregation"
    | "infra_investigation"
    | "validation_failure"
    | "controlled_write"
    | "requires_judgment";
  readonly description: string;
  readonly planYaml: string;
  readonly codeModeScript: string;
  readonly expectedSideEffects: readonly string[];
}

export interface BaselineMetric {
  readonly baseline: "Native_MCP" | "Hardened_Code_Mode" | "Project_X";
  readonly taskId: string;
  readonly modelRoundTrips: number;
  readonly inputTokensEstimated: number;
  readonly outputTokensEstimated: number;
  readonly latencyMs: number;
  readonly sideEffectsExecuted: readonly string[];
  readonly success: boolean;
  readonly auditabilityScore: number;
}
