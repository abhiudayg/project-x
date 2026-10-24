import { ToolAdapter, ToolCapability } from "./adapters/types.js";
import { ExecutionPlan, PolicyDecisionRecord } from "./types.js";

export class PolicyViolationError extends Error {
  constructor(
    message: string,
    public readonly decisions: readonly PolicyDecisionRecord[]
  ) {
    super(message);
    this.name = "PolicyViolationError";
  }
}

export interface RuntimePolicy {
  readonly allowedTools?: ReadonlySet<string>;
  readonly allowWrites?: boolean;
  readonly allowedPermissions?: ReadonlySet<string>;
  readonly callerIdentity?: string;
}

export class PolicyEngine {
  constructor(private readonly policy: RuntimePolicy = {}) {}

  async validatePreExecution(
    plan: ExecutionPlan,
    adapter: ToolAdapter
  ): Promise<readonly PolicyDecisionRecord[]> {
    const decisions: PolicyDecisionRecord[] = [];

    for (const perm of plan.spec.permissions) {
      if (
        this.policy.allowedPermissions &&
        !this.policy.allowedPermissions.has(perm)
      ) {
        const decision: PolicyDecisionRecord = {
          phase: "pre_execution",
          target: perm,
          action: "write",
          decision: "denied",
          reason: `Requested permission '${perm}' is not granted by runtime policy`,
        };
        decisions.push(decision);
        throw new PolicyViolationError(
          `Pre-execution authorization denied for permission '${perm}'`,
          [decision]
        );
      }
    }

    for (const step of plan.spec.steps) {
      const tool = await adapter.getTool(step.tool);
      if (!tool) {
        const decision: PolicyDecisionRecord = {
          phase: "pre_execution",
          target: step.tool,
          action: "read",
          decision: "denied",
          reason: `Tool '${step.tool}' not found in registry`,
        };
        decisions.push(decision);
        throw new PolicyViolationError(
          `Unknown tool '${step.tool}' in step '${step.id}'`,
          [decision]
        );
      }

      if (
        this.policy.allowedTools &&
        !this.policy.allowedTools.has(step.tool)
      ) {
        const decision: PolicyDecisionRecord = {
          phase: "pre_execution",
          target: step.tool,
          action: tool.type,
          decision: "denied",
          reason: `Tool '${step.tool}' is not in policy allowlist`,
        };
        decisions.push(decision);
        throw new PolicyViolationError(
          `Tool '${step.tool}' is prohibited by runtime policy`,
          [decision]
        );
      }

      if (tool.type === "write" && !this.policy.allowWrites) {
        const decision: PolicyDecisionRecord = {
          phase: "pre_execution",
          target: step.tool,
          action: "write",
          decision: "denied",
          reason: `Write operations disallowed by policy; step '${step.id}' requires write access`,
        };
        decisions.push(decision);
        throw new PolicyViolationError(
          `Write operation '${step.tool}' denied during pre-execution gating`,
          [decision]
        );
      }

      decisions.push({
        phase: "pre_execution",
        target: step.tool,
        action: tool.type,
        decision: "granted",
      });
    }

    return decisions;
  }

  checkToolBoundary(
    stepId: string,
    tool: ToolCapability
  ): PolicyDecisionRecord {
    if (this.policy.allowedTools && !this.policy.allowedTools.has(tool.name)) {
      const decision: PolicyDecisionRecord = {
        phase: "tool_boundary",
        target: tool.name,
        action: tool.type,
        decision: "denied",
        reason: `Tool boundary policy blocked tool '${tool.name}'`,
      };
      throw new PolicyViolationError(
        `Tool boundary denied execution for '${tool.name}' in step '${stepId}'`,
        [decision]
      );
    }

    if (tool.type === "write" && !this.policy.allowWrites) {
      const decision: PolicyDecisionRecord = {
        phase: "tool_boundary",
        target: tool.name,
        action: "write",
        decision: "denied",
        reason: `Write gate denied side-effecting call '${tool.name}'`,
      };
      throw new PolicyViolationError(
        `Tool boundary blocked unauthorized write for '${tool.name}'`,
        [decision]
      );
    }

    return {
      phase: "tool_boundary",
      target: tool.name,
      action: tool.type,
      decision: "granted",
    };
  }
}
