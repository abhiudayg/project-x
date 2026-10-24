import { ExecutionPlan, isStepReference, PlanStep } from "./types.js";
import { ValidationError } from "./parser.js";

const extractStepReferences = (args: Record<string, unknown>): string[] => {
  const refs: string[] = [];

  const visit = (val: unknown) => {
    if (isStepReference(val)) {
      refs.push(val.from);
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) {
        visit(item);
      }
      return;
    }
    if (typeof val === "object" && val !== null) {
      for (const v of Object.values(val)) {
        visit(v);
      }
    }
  };

  visit(args);
  return refs;
};

export interface DAGNode {
  readonly step: PlanStep;
  readonly dependencies: ReadonlySet<string>;
  readonly dependents: ReadonlySet<string>;
}

export interface DAGStructure {
  readonly nodes: ReadonlyMap<string, DAGNode>;
  readonly topologicalOrder: readonly string[];
  readonly executionWaves: readonly (readonly string[])[];
  readonly transitiveDownstream: ReadonlyMap<string, ReadonlySet<string>>;
}

export const buildDAG = (plan: ExecutionPlan): DAGStructure => {
  const stepMap = new Map<string, PlanStep>();
  for (const step of plan.spec.steps) {
    if (stepMap.has(step.id)) {
      throw new ValidationError(`Duplicate step id: '${step.id}'`);
    }
    stepMap.set(step.id, step);
  }

  const inDeps = new Map<string, Set<string>>();
  const outDeps = new Map<string, Set<string>>();

  for (const step of plan.spec.steps) {
    inDeps.set(step.id, new Set());
    outDeps.set(step.id, new Set());
  }

  for (const step of plan.spec.steps) {
    const declaredDeps = step.dependsOn ?? [];
    const argumentRefs = extractStepReferences(step.arguments);
    const combinedDeps = new Set([...declaredDeps, ...argumentRefs]);

    for (const dep of combinedDeps) {
      if (!stepMap.has(dep)) {
        throw new ValidationError(
          `Step '${step.id}' depends on undefined step '${dep}'`
        );
      }
      if (dep === step.id) {
        throw new ValidationError(
          `Step '${step.id}' cannot depend on itself (self-cycle)`
        );
      }
      inDeps.get(step.id)!.add(dep);
      outDeps.get(dep)!.add(step.id);
    }
  }

  const inDegree = new Map<string, number>();
  for (const [id, deps] of inDeps) {
    inDegree.set(id, deps.size);
  }

  const topologicalOrder: string[] = [];
  const executionWaves: string[][] = [];

  let currentWave = Array.from(stepMap.keys()).filter(
    (id) => inDegree.get(id) === 0
  );

  while (currentWave.length > 0) {
    executionWaves.push([...currentWave]);
    const nextWave: string[] = [];

    for (const id of currentWave) {
      topologicalOrder.push(id);
      for (const dependent of outDeps.get(id)!) {
        const remaining = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) {
          nextWave.push(dependent);
        }
      }
    }

    currentWave = nextWave;
  }

  if (topologicalOrder.length !== stepMap.size) {
    const unvisited = Array.from(stepMap.keys()).filter(
      (id) => !topologicalOrder.includes(id)
    );
    throw new ValidationError(
      `Cyclic dependency detected in execution plan involving steps: ${unvisited.join(", ")}`
    );
  }

  for (const step of plan.spec.output.include) {
    if (!stepMap.has(step)) {
      throw new ValidationError(
        `Plan output includes unknown step '${step}'`
      );
    }
  }

  const nodes = new Map<string, DAGNode>();
  for (const [id, step] of stepMap) {
    nodes.set(id, {
      step,
      dependencies: new Set(inDeps.get(id)!),
      dependents: new Set(outDeps.get(id)!),
    });
  }

  const transitiveDownstream = new Map<string, Set<string>>();
  for (let i = topologicalOrder.length - 1; i >= 0; i--) {
    const id = topologicalOrder[i]!;
    const allDownstream = new Set<string>();
    for (const child of outDeps.get(id)!) {
      allDownstream.add(child);
      const childDownstream = transitiveDownstream.get(child);
      if (childDownstream) {
        for (const cd of childDownstream) {
          allDownstream.add(cd);
        }
      }
    }
    transitiveDownstream.set(id, allDownstream);
  }

  return {
    nodes,
    topologicalOrder,
    executionWaves,
    transitiveDownstream,
  };
};
