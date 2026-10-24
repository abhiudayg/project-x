import { z } from "zod";

export const StepReferenceSchema = z
  .object({
    from: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

export type StepReference = z.infer<typeof StepReferenceSchema>;

export const isStepReference = (val: unknown): val is StepReference => {
  return (
    typeof val === "object" &&
    val !== null &&
    "from" in val &&
    "path" in val &&
    typeof (val as Record<string, unknown>).from === "string" &&
    typeof (val as Record<string, unknown>).path === "string"
  );
};

export const PlanLimitsSchema = z
  .object({
    maxSteps: z.number().int().positive().default(50),
    timeoutMs: z.number().int().positive().default(60000),
    maxResultBytes: z.number().int().positive().default(1048576),
  })
  .strict();

export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export const PlanStepSchema = z
  .object({
    id: z.string().min(1),
    tool: z.string().min(1),
    dependsOn: z.array(z.string().min(1)).optional().default([]),
    arguments: z.record(z.unknown()).default({}),
    requiresJudgment: z.boolean().optional().default(false),
    timeoutMs: z.number().int().positive().optional(),
    idempotencyKey: z.string().optional(),
  })
  .strict();

export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanSchema = z
  .object({
    apiVersion: z.literal("x.dev/v1alpha1"),
    kind: z.literal("ExecutionPlan"),
    metadata: z
      .object({
        name: z.string().min(1),
        correlationId: z.string().optional(),
      })
      .strict(),
    spec: z
      .object({
        limits: PlanLimitsSchema.default({
          maxSteps: 50,
          timeoutMs: 60000,
          maxResultBytes: 1048576,
        }),
        permissions: z.array(z.string()).default([]),
        steps: z.array(PlanStepSchema).min(1),
        output: z
          .object({
            include: z.array(z.string()),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export type StepStatus =
  | "success"
  | "failed"
  | "skipped"
  | "cancelled"
  | "timed_out";

export type VerificationStatus = "verified" | "failed" | "unverified";

export type ExecutionStatus = "complete" | "incomplete" | "failed";

export interface StepExecutionRecord {
  readonly tool: string;
  readonly status: StepStatus;
  readonly durationMs: number;
  readonly attempts: number;
  readonly argumentHash: string;
  readonly verification: VerificationStatus;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface PolicyDecisionRecord {
  readonly phase: "pre_execution" | "tool_boundary";
  readonly target: string;
  readonly action: "read" | "write";
  readonly decision: "granted" | "denied";
  readonly reason?: string;
}

export interface ExecutionReceipt {
  readonly planId: string;
  readonly schemaVersion: string;
  readonly planDigest: string;
  readonly executionId: string;
  readonly timestamps: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly durationMs: number;
  };
  readonly status: ExecutionStatus;
  readonly handback?: {
    readonly stepId: string;
    readonly reason: "requiresJudgment" | "budgetExceeded" | "timeout";
  };
  readonly steps: Record<string, StepExecutionRecord>;
  readonly outputs: Record<string, unknown>;
  readonly policyDecisions: readonly PolicyDecisionRecord[];
  readonly metrics: {
    readonly totalBytesProcessed: number;
    readonly interpreterOverheadMs: number;
  };
}
