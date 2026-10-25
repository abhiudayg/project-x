import { ProjectXClient } from "./client.js";
import { ExecutionOptions } from "../interpreter.js";

export interface LangChainToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly schema: {
    readonly type: "object";
    readonly properties: {
      readonly planYaml: {
        readonly type: "string";
        readonly description: string;
      };
    };
    readonly required: readonly ["planYaml"];
  };
  readonly call: (args: { planYaml: string }) => Promise<string>;
}

export const createProjectXLangChainTool = (
  client: ProjectXClient,
  options?: ExecutionOptions
): LangChainToolDefinition => {
  return {
    name: "x_execute_plan",
    description:
      "Execute a bounded, deterministic multi-tool workflow above registered tools in a single turn. Pass an ExecutionPlan formatted as valid YAML conforming to apiVersion 'x.dev/v1alpha1'. Returns structured output and receipt.",
    schema: {
      type: "object",
      properties: {
        planYaml: {
          type: "string",
          description: "YAML-encoded ExecutionPlan conforming to x.dev/v1alpha1 schema",
        },
      },
      required: ["planYaml"],
    },
    call: async ({ planYaml }: { planYaml: string }): Promise<string> => {
      const validation = client.validatePlan(planYaml);
      if (!validation.valid) {
        return JSON.stringify({
          error: "Plan validation failed",
          details: validation.errors,
        });
      }

      const result = await client.executePlan(validation.plan, options);
      return JSON.stringify({
        status: result.receipt.status,
        planId: result.receipt.planId,
        durationMs: result.receipt.timestamps.durationMs,
        outputs: result.outputs,
        receipt: result.receipt,
      });
    },
  };
};
