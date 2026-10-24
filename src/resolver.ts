import { isStepReference } from "./types.js";

export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionError";
  }
}

export const extractPath = (obj: unknown, path: string): unknown => {
  if (path === "" || path === ".") {
    return obj;
  }

  const segments = path.split(".");
  let current: unknown = obj;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (current === null || current === undefined) {
      throw new ResolutionError(
        `Cannot extract path '${path}': property '${segment}' accessed on ${String(current)}`
      );
    }

    if (Array.isArray(current)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) {
        throw new ResolutionError(
          `Array index '${segment}' out of bounds in path '${path}'`
        );
      }
      current = current[idx];
    } else if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (!(segment in record)) {
        throw new ResolutionError(
          `Field '${segment}' not found in path '${path}'`
        );
      }
      current = record[segment];
    } else {
      throw new ResolutionError(
        `Cannot extract property '${segment}' from primitive value in path '${path}'`
      );
    }
  }

  return current;
};

export const resolveArguments = (
  rawArgs: Record<string, unknown>,
  stepOutputs: ReadonlyMap<string, unknown>
): Record<string, unknown> => {
  const resolveValue = (val: unknown): unknown => {
    if (isStepReference(val)) {
      if (!stepOutputs.has(val.from)) {
        throw new ResolutionError(
          `Referenced step '${val.from}' has no resolved output`
        );
      }
      const sourceOutput = stepOutputs.get(val.from);
      return extractPath(sourceOutput, val.path);
    }

    if (Array.isArray(val)) {
      return val.map((item) => resolveValue(item));
    }

    if (typeof val === "object" && val !== null) {
      const resolvedObj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(val)) {
        resolvedObj[k] = resolveValue(v);
      }
      return resolvedObj;
    }

    return val;
  };

  const resolved: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawArgs)) {
    resolved[key] = resolveValue(val);
  }
  return resolved;
};
