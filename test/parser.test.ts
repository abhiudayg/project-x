import test from "node:test";
import assert from "node:assert/strict";
import { parsePlan, ValidationError, computePlanDigest } from "../src/parser.js";

const validYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: test-plan
spec:
  limits:
    maxSteps: 5
    timeoutMs: 10000
    maxResultBytes: 2048
  permissions:
    - deployments.read
  steps:
    - id: step1
      tool: deployments.get
      arguments:
        name: api
  output:
    include:
      - step1
`;

test("parsePlan parses valid YAML successfully", () => {
  const { plan, digest } = parsePlan(validYaml);
  assert.equal(plan.metadata.name, "test-plan");
  assert.equal(plan.spec.steps.length, 1);
  assert.equal(plan.spec.steps[0]?.id, "step1");
  assert.ok(digest.length === 64);
});

test("parsePlan rejects unknown top-level fields (FR-1 strict schema)", () => {
  const invalidYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
unexpectedField: "should-fail"
metadata:
  name: bad-plan
spec:
  steps:
    - id: step1
      tool: test.tool
  output:
    include:
      - step1
`;
  assert.throws(
    () => parsePlan(invalidYaml),
    (err: unknown) => err instanceof ValidationError
  );
});

test("parsePlan rejects unsupported apiVersion", () => {
  const invalidYaml = validYaml.replace(
    "apiVersion: x.dev/v1alpha1",
    "apiVersion: x.dev/v2beta1"
  );
  assert.throws(
    () => parsePlan(invalidYaml),
    (err: unknown) => err instanceof ValidationError
  );
});

test("computePlanDigest is deterministic", () => {
  const { plan: p1, digest: d1 } = parsePlan(validYaml);
  const { plan: p2, digest: d2 } = parsePlan(validYaml);
  assert.equal(d1, d2);
  assert.equal(d1, computePlanDigest(p1));
});
