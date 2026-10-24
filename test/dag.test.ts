import test from "node:test";
import assert from "node:assert/strict";
import { parsePlan, ValidationError } from "../src/parser.js";
import { buildDAG } from "../src/dag.js";

test("buildDAG builds correct topological order and waves", () => {
  const yaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: dag-test
spec:
  steps:
    - id: a
      tool: tool.a
    - id: b
      tool: tool.b
      dependsOn:
        - a
    - id: c
      tool: tool.c
      dependsOn:
        - a
    - id: d
      tool: tool.d
      dependsOn:
        - b
        - c
  output:
    include:
      - d
`;
  const { plan } = parsePlan(yaml);
  const dag = buildDAG(plan);

  assert.deepEqual(dag.executionWaves, [["a"], ["b", "c"], ["d"]]);
  assert.equal(dag.topologicalOrder[0], "a");
  assert.equal(dag.topologicalOrder[3], "d");
  assert.ok(dag.transitiveDownstream.get("a")?.has("d"));
  assert.ok(dag.transitiveDownstream.get("b")?.has("d"));
});

test("buildDAG detects cyclic dependencies", () => {
  const yaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: cycle-test
spec:
  steps:
    - id: a
      tool: tool.a
      dependsOn:
        - b
    - id: b
      tool: tool.b
      dependsOn:
        - a
  output:
    include:
      - a
`;
  const { plan } = parsePlan(yaml);
  assert.throws(
    () => buildDAG(plan),
    (err: unknown) =>
      err instanceof ValidationError && err.message.includes("Cyclic dependency")
  );
});

test("buildDAG detects implicit cycle through argument reference", () => {
  const yaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: arg-cycle-test
spec:
  steps:
    - id: a
      tool: tool.a
      arguments:
        input:
          from: b
          path: output
    - id: b
      tool: tool.b
      dependsOn:
        - a
  output:
    include:
      - b
`;
  const { plan } = parsePlan(yaml);
  assert.throws(
    () => buildDAG(plan),
    (err: unknown) =>
      err instanceof ValidationError && err.message.includes("Cyclic dependency")
  );
});

test("buildDAG rejects duplicate step ids", () => {
  const yaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: dup-test
spec:
  steps:
    - id: dup
      tool: tool.a
    - id: dup
      tool: tool.b
  output:
    include:
      - dup
`;
  const { plan } = parsePlan(yaml);
  assert.throws(
    () => buildDAG(plan),
    (err: unknown) =>
      err instanceof ValidationError && err.message.includes("Duplicate step id")
  );
});
