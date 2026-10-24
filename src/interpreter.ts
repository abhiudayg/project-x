import { ToolAdapter } from "./adapters/types.js";
import { buildDAG, DAGStructure } from "./dag.js";
import { parsePlan, ValidationError } from "./parser.js";
import { PolicyEngine, RuntimePolicy } from "./policy.js";
import { hashArguments, ReceiptBuilder } from "./receipt.js";
import { resolveArguments } from "./resolver.js";
import { ExecutionPlan, ExecutionReceipt, StepExecutionRecord } from "./types.js";
import { Verifier } from "./verifier.js";

export interface ExecutionOptions {
  readonly policy?: RuntimePolicy;
  readonly callerIdentity?: string;
}

export interface InterpreterResult {
  readonly receipt: ExecutionReceipt;
  readonly outputs: Record<string, unknown>;
}

export class Interpreter {
  constructor(
    private readonly adapter: ToolAdapter,
    private readonly options: ExecutionOptions = {}
  ) {}

  async execute(planInput: string | ExecutionPlan): Promise<InterpreterResult> {
    const overheadStart = performance.now();
    let plan: ExecutionPlan;
    let digest: string;

    if (typeof planInput === "string") {
      const parsed = parsePlan(planInput);
      plan = parsed.plan;
      digest = parsed.digest;
    } else {
      plan = planInput;
      const { computePlanDigest } = await import("./parser.js");
      digest = computePlanDigest(plan);
    }

    const receiptBuilder = new ReceiptBuilder(
      plan.metadata.name,
      digest,
      plan.apiVersion
    );

    const limits = plan.spec.limits;
    if (plan.spec.steps.length > limits.maxSteps) {
      throw new ValidationError(
        `Plan exceeds maximum allowed steps (${plan.spec.steps.length} > ${limits.maxSteps})`
      );
    }

    const dag: DAGStructure = buildDAG(plan);
    const policyEngine = new PolicyEngine(this.options.policy);
    const preDecisions = await policyEngine.validatePreExecution(
      plan,
      this.adapter
    );
    receiptBuilder.recordPolicyDecisions(preDecisions);

    receiptBuilder.addInterpreterOverhead(performance.now() - overheadStart);

    const stepOutputs = new Map<string, unknown>();
    const skippedSteps = new Set<string>();
    let totalBytesAccumulated = 0;
    let hadFailure = false;
    let handbackEncountered = false;

    const globalAbortController = new AbortController();
    const globalTimeoutId = setTimeout(() => {
      globalAbortController.abort();
    }, limits.timeoutMs);

    try {
      for (const wave of dag.executionWaves) {
        if (hadFailure || handbackEncountered || globalAbortController.signal.aborted) {
          break;
        }

        for (const stepId of wave) {
          if (skippedSteps.has(stepId)) {
            receiptBuilder.recordStep(stepId, {
              tool: dag.nodes.get(stepId)!.step.tool,
              status: "skipped",
              durationMs: 0,
              attempts: 0,
              argumentHash: "",
              verification: "unverified",
            });
            continue;
          }

          const node = dag.nodes.get(stepId)!;
          const step = node.step;

          if (step.requiresJudgment) {
            receiptBuilder.recordStep(stepId, {
              tool: step.tool,
              status: "skipped",
              durationMs: 0,
              attempts: 0,
              argumentHash: "",
              verification: "unverified",
            });
            receiptBuilder.recordHandback(stepId, "requiresJudgment");
            handbackEncountered = true;
            break;
          }

          const stepOverheadStart = performance.now();
          let resolvedArgs: Record<string, unknown>;
          try {
            resolvedArgs = resolveArguments(step.arguments, stepOutputs);
          } catch (err) {
            receiptBuilder.addInterpreterOverhead(
              performance.now() - stepOverheadStart
            );
            receiptBuilder.recordStep(stepId, {
              tool: step.tool,
              status: "failed",
              durationMs: 0,
              attempts: 1,
              argumentHash: "",
              verification: "unverified",
              error: {
                code: "RESOLUTION_ERROR",
                message: err instanceof Error ? err.message : String(err),
              },
            });
            hadFailure = true;
            this.markDownstreamSkipped(stepId, dag, skippedSteps);
            continue;
          }

          const argHash = hashArguments(resolvedArgs);
          const toolCap = await this.adapter.getTool(step.tool);
          if (!toolCap) {
            hadFailure = true;
            continue;
          }

          const boundaryDecision = policyEngine.checkToolBoundary(
            stepId,
            toolCap
          );
          receiptBuilder.recordPolicyDecision(boundaryDecision);
          receiptBuilder.addInterpreterOverhead(
            performance.now() - stepOverheadStart
          );

          const stepStartTime = performance.now();
          const stepTimeoutMs = step.timeoutMs ?? limits.timeoutMs;
          const stepAbortController = new AbortController();
          const stepTimeoutId = setTimeout(
            () => stepAbortController.abort(),
            stepTimeoutMs
          );

          try {
            const rawResult = await this.adapter.execute(
              step.tool,
              resolvedArgs,
              {
                signal: stepAbortController.signal,
                idempotencyKey: step.idempotencyKey,
                callerIdentity: this.options.callerIdentity,
              }
            );
            clearTimeout(stepTimeoutId);
            const stepDurationMs = Math.round(performance.now() - stepStartTime);

            const resultJson = JSON.stringify(rawResult ?? null);
            const resultBytes = Buffer.byteLength(resultJson, "utf8");
            totalBytesAccumulated += resultBytes;

            if (totalBytesAccumulated > limits.maxResultBytes) {
              receiptBuilder.recordStep(stepId, {
                tool: step.tool,
                status: "failed",
                durationMs: stepDurationMs,
                attempts: 1,
                argumentHash: argHash,
                verification: "unverified",
                error: {
                  code: "RESULT_SIZE_EXCEEDED",
                  message: `Plan exceeded maximum allowed result bytes (${totalBytesAccumulated} > ${limits.maxResultBytes})`,
                },
              });
              hadFailure = true;
              this.markDownstreamSkipped(stepId, dag, skippedSteps);
              continue;
            }

            const verifyStart = performance.now();
            const verification = await Verifier.evaluateStep(
              toolCap,
              rawResult,
              resolvedArgs,
              this.adapter
            );
            receiptBuilder.addInterpreterOverhead(
              performance.now() - verifyStart
            );

            stepOutputs.set(stepId, rawResult);
            receiptBuilder.recordStep(
              stepId,
              {
                tool: step.tool,
                status: "success",
                durationMs: stepDurationMs,
                attempts: 1,
                argumentHash: argHash,
                verification,
              },
              resultBytes
            );
          } catch (err) {
            clearTimeout(stepTimeoutId);
            const stepDurationMs = Math.round(performance.now() - stepStartTime);
            const isTimeout =
              stepAbortController.signal.aborted ||
              (err instanceof Error && err.name === "AbortError");

            receiptBuilder.recordStep(stepId, {
              tool: step.tool,
              status: isTimeout ? "timed_out" : "failed",
              durationMs: stepDurationMs,
              attempts: 1,
              argumentHash: argHash,
              verification: "unverified",
              error: {
                code: isTimeout ? "TIMEOUT" : "EXECUTION_ERROR",
                message: err instanceof Error ? err.message : String(err),
              },
            });
            hadFailure = true;
            this.markDownstreamSkipped(stepId, dag, skippedSteps);
          }
        }
      }
    } finally {
      clearTimeout(globalTimeoutId);
    }

    for (const stepId of dag.topologicalOrder) {
      if (!receiptBuilder.hasStep(stepId)) {
        receiptBuilder.recordStep(stepId, {
          tool: dag.nodes.get(stepId)!.step.tool,
          status: "skipped",
          durationMs: 0,
          attempts: 0,
          argumentHash: "",
          verification: "unverified",
        });
      }
    }

    const finalOutputs: Record<string, unknown> = {};
    for (const outKey of plan.spec.output.include) {
      if (stepOutputs.has(outKey)) {
        finalOutputs[outKey] = stepOutputs.get(outKey);
      }
    }
    receiptBuilder.setOutputs(finalOutputs);

    if (handbackEncountered) {
      receiptBuilder.setStatus("incomplete");
    } else if (hadFailure) {
      receiptBuilder.setStatus("failed");
    } else {
      receiptBuilder.setStatus("complete");
    }

    const receipt = receiptBuilder.build();
    return { receipt, outputs: finalOutputs };
  }

  private markDownstreamSkipped(
    failedStepId: string,
    dag: DAGStructure,
    skippedSet: Set<string>
  ): void {
    const downstream = dag.transitiveDownstream.get(failedStepId);
    if (downstream) {
      for (const d of downstream) {
        skippedSet.add(d);
      }
    }
  }
}
