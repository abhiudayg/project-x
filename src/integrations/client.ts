import { parsePlan } from "../parser.js";
import { buildDAG, DAGStructure } from "../dag.js";
import { Interpreter, ExecutionOptions } from "../interpreter.js";
import { ToolAdapter } from "../adapters/types.js";
import { ExecutionPlan, ExecutionReceipt } from "../types.js";

export interface PlanValidationResult {
  readonly valid: boolean;
  readonly plan: ExecutionPlan;
  readonly digest: string;
  readonly dag: DAGStructure;
  readonly errors: readonly string[];
}

export class ProjectXClient {
  private readonly adapter: ToolAdapter;
  private readonly defaultOptions?: ExecutionOptions;

  constructor(adapter: ToolAdapter, defaultOptions?: ExecutionOptions) {
    this.adapter = adapter;
    this.defaultOptions = defaultOptions;
  }

  validatePlan(planInput: string | ExecutionPlan): PlanValidationResult {
    try {
      const parsed = typeof planInput === "string" ? parsePlan(planInput) : { plan: planInput, digest: "" };
      const dag = buildDAG(parsed.plan);
      return {
        valid: true,
        plan: parsed.plan,
        digest: parsed.digest,
        dag,
        errors: [],
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const fallbackPlan: ExecutionPlan = {
        apiVersion: "x.dev/v1alpha1",
        kind: "ExecutionPlan",
        metadata: { name: "invalid" },
        spec: {
          limits: { maxSteps: 50, timeoutMs: 60000, maxResultBytes: 1048576 },
          permissions: [],
          steps: [],
          output: { include: [] },
        },
      };
      return {
        valid: false,
        plan: fallbackPlan,
        digest: "",
        dag: {
          nodes: new Map(),
          topologicalOrder: [],
          executionWaves: [],
          transitiveDownstream: new Map(),
        },
        errors: [errorMsg],
      };
    }
  }

  async executePlan(
    planInput: string | ExecutionPlan,
    options?: ExecutionOptions
  ): Promise<{ receipt: ExecutionReceipt; outputs: Record<string, unknown> }> {
    const parsed = typeof planInput === "string" ? parsePlan(planInput) : { plan: planInput };
    const mergedOptions: ExecutionOptions = {
      ...this.defaultOptions,
      ...options,
      policy: {
        ...this.defaultOptions?.policy,
        ...options?.policy,
      },
    };

    const interpreter = new Interpreter(this.adapter, mergedOptions);
    return interpreter.execute(parsed.plan);
  }

  async resumePlan(
    planInput: string | ExecutionPlan,
    previousReceipt: ExecutionReceipt,
    judgmentDecision: Record<string, unknown>,
    options?: ExecutionOptions
  ): Promise<{ receipt: ExecutionReceipt; outputs: Record<string, unknown> }> {
    const parsed = typeof planInput === "string" ? parsePlan(planInput) : { plan: planInput };
    const originalPlan = parsed.plan;

    const completedStepIds = new Set(
      Object.entries(previousReceipt.steps)
        .filter(([, step]) => step.status === "success")
        .map(([id]) => id)
    );

    const judgmentStepId = previousReceipt.handback?.stepId;

    const remainingSteps = originalPlan.spec.steps.map((step) => {
      if (completedStepIds.has(step.id)) {
        return {
          ...step,
          requiresJudgment: false,
        };
      }
      if (step.id === judgmentStepId) {
        return {
          ...step,
          requiresJudgment: false,
          arguments: {
            ...step.arguments,
            ...judgmentDecision,
          },
        };
      }
      return step;
    });

    const resumedPlan: ExecutionPlan = {
      ...originalPlan,
      metadata: {
        ...originalPlan.metadata,
        name: `${originalPlan.metadata.name}-resumed`,
      },
      spec: {
        ...originalPlan.spec,
        steps: remainingSteps,
      },
    };

    return this.executePlan(resumedPlan, options);
  }
}
