import yaml from "yaml";
import { z } from "zod";
import {
  ExecutionPlan,
  ExecutionPlanSchema,
  PlanStep,
  StepReference,
} from "./types.js";

export const TraceTurnSchema = z
  .object({
    id: z.string().optional(),
    tool: z.string().min(1),
    arguments: z.record(z.unknown()).default({}),
    output: z.unknown().optional(),
    requiresJudgment: z.boolean().optional().default(false),
    tokens: z
      .object({
        input: z.number().nonnegative().optional(),
        output: z.number().nonnegative().optional(),
      })
      .optional(),
    durationMs: z.number().nonnegative().optional(),
  })
  .strict();

export type TraceTurn = z.infer<typeof TraceTurnSchema>;

export const AgentTraceSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    turns: z.array(TraceTurnSchema).min(1),
    modelCostPerMillionInput: z.number().positive().optional().default(3.0),
    modelCostPerMillionOutput: z.number().positive().optional().default(15.0),
  })
  .strict();

export type AgentTrace = z.infer<typeof AgentTraceSchema>;

export interface AuditSavings {
  readonly baselineRoundTrips: number;
  readonly projectXRoundTrips: number;
  readonly roundTripsSaved: number;
  readonly baselineTokens: number;
  readonly projectXTokens: number;
  readonly tokensSaved: number;
  readonly tokenSavingsPercentage: number;
  readonly estimatedBaselineCostUsd: number;
  readonly estimatedProjectXCostUsd: number;
  readonly costSavingsUsd: number;
  readonly estimatedLatencyReductionMs: number;
}

export interface SecurityAuditResult {
  readonly readTools: readonly string[];
  readonly writeTools: readonly string[];
  readonly permissionsRequired: readonly string[];
  readonly judgmentStepsCount: number;
  readonly automatedStepsCount: number;
}

export interface AuditReport {
  readonly traceName: string;
  readonly generatedAt: string;
  readonly generatedPlan: ExecutionPlan;
  readonly planYaml: string;
  readonly savings: AuditSavings;
  readonly security: SecurityAuditResult;
  readonly markdownSummary: string;
}

const READ_PREFIX_REGEX = /^(get|list|fetch|read|describe|scan|check|query|find|inspect|search)(_|\.|$)/i;
const WRITE_VERB_REGEX = /^(create|delete|remove|write|update|patch|post|deploy|restart|kill|set|apply)(_|\.|$)|(_|\.)(create|delete|remove|write|update|patch|post|deploy|restart|kill|set|apply)$/i;

const isWriteTool = (toolName: string): boolean => {
  if (READ_PREFIX_REGEX.test(toolName)) {
    return false;
  }
  return WRITE_VERB_REGEX.test(toolName);
};

const findMatchingPath = (
  value: unknown,
  output: unknown,
  currentPath = ""
): string | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof output !== "object" || output === null) {
    if (output === value) {
      return currentPath || "result";
    }
    return null;
  }

  if (Array.isArray(output)) {
    for (let i = 0; i < output.length; i++) {
      const arrayPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
      const match = findMatchingPath(value, output[i], arrayPath);
      if (match) return match;
    }
    return null;
  }

  const record = output as Record<string, unknown>;
  for (const [key, propVal] of Object.entries(record)) {
    const propPath = currentPath ? `${currentPath}.${key}` : key;
    if (propVal === value) {
      return propPath;
    }
    if (typeof propVal === "object" && propVal !== null) {
      const nested = findMatchingPath(value, propVal, propPath);
      if (nested) return nested;
    }
  }

  return null;
};

export const normalizeTrace = (input: unknown): AgentTrace => {
  if (Array.isArray(input)) {
    return AgentTraceSchema.parse({
      name: "imported-trace",
      turns: input,
    });
  }

  if (typeof input === "object" && input !== null) {
    const raw = input as Record<string, unknown>;

    if (Array.isArray(raw.turns)) {
      return AgentTraceSchema.parse(raw);
    }

    if (Array.isArray(raw.steps)) {
      return AgentTraceSchema.parse({
        name: typeof raw.name === "string" ? raw.name : "imported-trace",
        description: typeof raw.description === "string" ? raw.description : undefined,
        turns: raw.steps,
      });
    }

    if (Array.isArray(raw.messages)) {
      const extractedTurns: TraceTurn[] = [];
      const messages = raw.messages as Array<Record<string, unknown>>;
      const toolOutputs = new Map<string, unknown>();

      for (const msg of messages) {
        if (msg.role === "tool" && typeof msg.tool_call_id === "string") {
          let parsedContent: unknown = msg.content;
          if (typeof msg.content === "string") {
            try {
              parsedContent = JSON.parse(msg.content);
            } catch {
              parsedContent = msg.content;
            }
          }
          toolOutputs.set(msg.tool_call_id, parsedContent);
        }
      }

      for (const msg of messages) {
        if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
          for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
            const id = typeof tc.id === "string" ? tc.id : undefined;
            const fn = (tc.function as Record<string, unknown>) || {};
            const tool = typeof fn.name === "string" ? fn.name : "unknown_tool";
            let args: Record<string, unknown> = {};
            if (typeof fn.arguments === "string") {
              try {
                args = JSON.parse(fn.arguments);
              } catch {
                args = {};
              }
            } else if (typeof fn.arguments === "object" && fn.arguments !== null) {
              args = fn.arguments as Record<string, unknown>;
            }

            extractedTurns.push({
              id,
              tool,
              arguments: args,
              output: id ? toolOutputs.get(id) : undefined,
              requiresJudgment: false,
            });
          }
        }
      }

      if (extractedTurns.length > 0) {
        return AgentTraceSchema.parse({
          name: typeof raw.name === "string" ? raw.name : "openai-trace",
          turns: extractedTurns,
        });
      }
    }
  }

  throw new Error("Unable to parse agent trace: input is neither an array nor a known trace format");
};

export const compileTraceToPlan = (trace: AgentTrace): ExecutionPlan => {
  const steps: PlanStep[] = [];
  const permissions = new Set<string>();
  const outputsToInclude: string[] = [];

  const previousOutputs = new Map<string, unknown>();

  trace.turns.forEach((turn, index) => {
    const stepId = turn.id || `step_${index + 1}_${turn.tool.replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const isWrite = isWriteTool(turn.tool);
    const permission = `tools:${turn.tool}:${isWrite ? "write" : "read"}`;
    permissions.add(permission);

    const dependsOnSet = new Set<string>();
    const transformedArgs: Record<string, unknown> = {};

    for (const [argKey, argValue] of Object.entries(turn.arguments)) {
      let matchedRef: StepReference | null = null;

      for (const [prevStepId, prevOut] of previousOutputs.entries()) {
        const foundPath = findMatchingPath(argValue, prevOut);
        if (foundPath) {
          matchedRef = { from: prevStepId, path: foundPath };
          dependsOnSet.add(prevStepId);
          break;
        }
      }

      if (matchedRef) {
        transformedArgs[argKey] = matchedRef;
      } else {
        transformedArgs[argKey] = argValue;
      }
    }

    if (dependsOnSet.size === 0 && index > 0 && isWrite) {
      dependsOnSet.add(steps[index - 1].id);
    }

    if (turn.output !== undefined) {
      previousOutputs.set(stepId, turn.output);
    }

    steps.push({
      id: stepId,
      tool: turn.tool,
      dependsOn: Array.from(dependsOnSet),
      arguments: transformedArgs,
      requiresJudgment: turn.requiresJudgment ?? false,
    });

    outputsToInclude.push(stepId);
  });

  const planName = (trace.name || "compiled-pipeline")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "") || "compiled-pipeline";

  const rawPlan = {
    apiVersion: "x.dev/v1alpha1",
    kind: "ExecutionPlan",
    metadata: {
      name: planName,
    },
    spec: {
      limits: {
        maxSteps: Math.max(50, steps.length + 10),
        timeoutMs: 60000,
        maxResultBytes: 1048576,
      },
      permissions: Array.from(permissions),
      steps,
      output: {
        include: outputsToInclude,
      },
    },
  };

  return ExecutionPlanSchema.parse(rawPlan);
};

export const calculateAuditSavings = (trace: AgentTrace): AuditSavings => {
  const turnCount = trace.turns.length;
  const judgmentCount = trace.turns.filter((t) => t.requiresJudgment).length;

  const baselineRoundTrips = turnCount + 1;
  const projectXRoundTrips = 1 + judgmentCount;
  const roundTripsSaved = Math.max(0, baselineRoundTrips - projectXRoundTrips);

  let baselineTokens = 0;
  let accumulatedContext = 1200;

  for (const turn of trace.turns) {
    const inputTok = turn.tokens?.input ?? accumulatedContext;
    const outputTok = turn.tokens?.output ?? 250;
    baselineTokens += inputTok + outputTok;
    const estResultTokens = turn.output ? Math.round(JSON.stringify(turn.output).length / 4) : 150;
    accumulatedContext += estResultTokens + 80;
  }
  baselineTokens += accumulatedContext + 300;

  const planTokens = 450 + turnCount * 80;
  const receiptTokens = 350 + turnCount * 40;
  const finalSynthesisTokens = 400;
  const projectXTokens = 1200 + planTokens + receiptTokens + finalSynthesisTokens;

  const tokensSaved = Math.max(0, baselineTokens - projectXTokens);
  const tokenSavingsPercentage = baselineTokens > 0
    ? Math.round((tokensSaved / baselineTokens) * 1000) / 10
    : 0;

  const costPerInput = trace.modelCostPerMillionInput / 1_000_000;
  const costPerOutput = trace.modelCostPerMillionOutput / 1_000_000;

  const estimatedBaselineCostUsd = (baselineTokens * 0.8) * costPerInput + (baselineTokens * 0.2) * costPerOutput;
  const estimatedProjectXCostUsd = (projectXTokens * 0.8) * costPerInput + (projectXTokens * 0.2) * costPerOutput;
  const costSavingsUsd = Math.max(0, estimatedBaselineCostUsd - estimatedProjectXCostUsd);

  const estimatedLatencyReductionMs = roundTripsSaved * 1400;

  return {
    baselineRoundTrips,
    projectXRoundTrips,
    roundTripsSaved,
    baselineTokens,
    projectXTokens,
    tokensSaved,
    tokenSavingsPercentage,
    estimatedBaselineCostUsd: Math.round(estimatedBaselineCostUsd * 10000) / 10000,
    estimatedProjectXCostUsd: Math.round(estimatedProjectXCostUsd * 10000) / 10000,
    costSavingsUsd: Math.round(costSavingsUsd * 10000) / 10000,
    estimatedLatencyReductionMs,
  };
};

export const auditTrace = (rawTrace: unknown): AuditReport => {
  const trace = normalizeTrace(rawTrace);
  const generatedPlan = compileTraceToPlan(trace);
  const savings = calculateAuditSavings(trace);

  const readTools = new Set<string>();
  const writeTools = new Set<string>();

  for (const turn of trace.turns) {
    if (isWriteTool(turn.tool)) {
      writeTools.add(turn.tool);
    } else {
      readTools.add(turn.tool);
    }
  }

  const security: SecurityAuditResult = {
    readTools: Array.from(readTools),
    writeTools: Array.from(writeTools),
    permissionsRequired: generatedPlan.spec.permissions,
    judgmentStepsCount: trace.turns.filter((t) => t.requiresJudgment).length,
    automatedStepsCount: trace.turns.filter((t) => !t.requiresJudgment).length,
  };

  const planYaml = yaml.stringify(generatedPlan);

  const markdownSummary = `# Project X Agent Audit Report
**Trace Name:** ${trace.name || "agent-trace"}
**Generated At:** ${new Date().toISOString()}

## 1. Economic & Latency Optimization
| Metric | Baseline (Native Agent) | Project X Execution | Savings |
| :--- | :--- | :--- | :--- |
| **Model Round Trips** | ${savings.baselineRoundTrips} | ${savings.projectXRoundTrips} | **${savings.roundTripsSaved} (${Math.round((savings.roundTripsSaved / savings.baselineRoundTrips) * 100)}%)** |
| **Estimated Context Tokens** | ${savings.baselineTokens.toLocaleString()} | ${savings.projectXTokens.toLocaleString()} | **${savings.tokensSaved.toLocaleString()} (${savings.tokenSavingsPercentage}%)** |
| **Estimated LLM Cost** | $${savings.estimatedBaselineCostUsd.toFixed(4)} | $${savings.estimatedProjectXCostUsd.toFixed(4)} | **$${savings.costSavingsUsd.toFixed(4)}** |
| **Estimated Latency Saved** | Baseline | -${(savings.estimatedLatencyReductionMs / 1000).toFixed(1)}s | **~${savings.estimatedLatencyReductionMs}ms** |

## 2. Security & Boundary Analysis
- **Read Tools Identified (${security.readTools.length}):** ${security.readTools.join(", ") || "None"}
- **Write / Side-Effect Tools (${security.writeTools.length}):** ${security.writeTools.join(", ") || "None"}
- **Automated Deterministic Steps:** ${security.automatedStepsCount}
- **Steps Yielding to Model (Judgment):** ${security.judgmentStepsCount}
- **Enforced Permissions:** \`${security.permissionsRequired.join("`, `")}\`

## 3. Compiled Declarative Plan
\`\`\`yaml
${planYaml.trim()}
\`\`\`
`;

  return {
    traceName: trace.name || "agent-trace",
    generatedAt: new Date().toISOString(),
    generatedPlan,
    planYaml,
    savings,
    security,
    markdownSummary,
  };
};
