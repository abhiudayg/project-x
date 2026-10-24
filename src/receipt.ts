import { createHash, randomUUID } from "node:crypto";
import {
  ExecutionReceipt,
  ExecutionStatus,
  PolicyDecisionRecord,
  StepExecutionRecord,
} from "./types.js";

export const hashArguments = (args: Record<string, unknown>): string => {
  const canonical = JSON.stringify(args, Object.keys(args).sort());
  return createHash("sha256").update(canonical).digest("hex");
};

export class ReceiptBuilder {
  private readonly executionId: string;
  private readonly startedAt: Date;
  private completedAt?: Date;
  private status: ExecutionStatus = "incomplete";
  private handbackDetails?: {
    stepId: string;
    reason: "requiresJudgment" | "budgetExceeded" | "timeout";
  };
  private readonly steps: Record<string, StepExecutionRecord> = {};
  private readonly policyDecisions: PolicyDecisionRecord[] = [];
  private outputs: Record<string, unknown> = {};
  private totalBytesProcessed = 0;
  private interpreterOverheadMs = 0;

  constructor(
    private readonly planId: string,
    private readonly planDigest: string,
    private readonly schemaVersion = "x.dev/v1alpha1"
  ) {
    this.executionId = randomUUID();
    this.startedAt = new Date();
  }

  recordPolicyDecision(decision: PolicyDecisionRecord): void {
    this.policyDecisions.push(decision);
  }

  recordPolicyDecisions(decisions: readonly PolicyDecisionRecord[]): void {
    for (const d of decisions) {
      this.policyDecisions.push(d);
    }
  }

  hasStep(id: string): boolean {
    return id in this.steps;
  }

  recordStep(id: string, record: StepExecutionRecord, bytes = 0): void {
    this.steps[id] = record;
    this.totalBytesProcessed += bytes;
  }

  recordHandback(
    stepId: string,
    reason: "requiresJudgment" | "budgetExceeded" | "timeout"
  ): void {
    this.handbackDetails = { stepId, reason };
    this.status = "incomplete";
  }

  setOutputs(outputs: Record<string, unknown>): void {
    this.outputs = { ...outputs };
  }

  setStatus(status: ExecutionStatus): void {
    this.status = status;
  }

  addInterpreterOverhead(ms: number): void {
    this.interpreterOverheadMs += ms;
  }

  build(): ExecutionReceipt {
    const end = this.completedAt ?? new Date();
    const durationMs = Math.max(0, end.getTime() - this.startedAt.getTime());

    return {
      planId: this.planId,
      schemaVersion: this.schemaVersion,
      planDigest: this.planDigest,
      executionId: this.executionId,
      timestamps: {
        startedAt: this.startedAt.toISOString(),
        completedAt: end.toISOString(),
        durationMs,
      },
      status: this.status,
      handback: this.handbackDetails,
      steps: { ...this.steps },
      outputs: { ...this.outputs },
      policyDecisions: [...this.policyDecisions],
      metrics: {
        totalBytesProcessed: this.totalBytesProcessed,
        interpreterOverheadMs: Math.round(this.interpreterOverheadMs * 100) / 100,
      },
    };
  }
}
