import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { ZodError } from "zod";
import { ExecutionPlan, ExecutionPlanSchema } from "./types.js";

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details: readonly unknown[] = []
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export const computePlanDigest = (plan: ExecutionPlan): string => {
  const canonical = JSON.stringify(plan, Object.keys(plan).sort());
  return createHash("sha256").update(canonical).digest("hex");
};

export const parsePlan = (raw: string): { plan: ExecutionPlan; digest: string } => {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new ValidationError(
      `Plan document syntax error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ValidationError("Execution plan must be an object");
  }

  try {
    const plan = ExecutionPlanSchema.parse(parsed);
    const digest = computePlanDigest(plan);
    return { plan, digest };
  } catch (err) {
    if (err instanceof ZodError) {
      const issues = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      throw new ValidationError(
        `Plan schema validation failed:\n- ${issues.join("\n- ")}`,
        err.issues
      );
    }
    throw err;
  }
};
