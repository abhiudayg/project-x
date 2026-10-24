import test from "node:test";
import assert from "node:assert/strict";
import { parsePlan } from "../src/parser.js";
import { PolicyEngine, PolicyViolationError } from "../src/policy.js";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";

const setupAdapter = () => {
  const adapter = new InMemoryToolAdapter();
  adapter.registerTool({
    capability: {
      name: "cluster.read_status",
      type: "read",
    },
    handler: () => ({ status: "ok" }),
  });
  adapter.registerTool({
    capability: {
      name: "cluster.scale_pods",
      type: "write",
    },
    handler: (args) => ({ scaled: args.replicas }),
  });
  return adapter;
};

test("PolicyEngine allows read tool when within policy", async () => {
  const adapter = setupAdapter();
  const policy = new PolicyEngine({
    allowedTools: new Set(["cluster.read_status"]),
    allowWrites: false,
  });

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: safe-read
spec:
  steps:
    - id: read
      tool: cluster.read_status
  output:
    include:
      - read
`;
  const { plan } = parsePlan(planYaml);
  const decisions = await policy.validatePreExecution(plan, adapter);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.decision, "granted");
});

test("PolicyEngine blocks write tool during pre-execution if allowWrites is false", async () => {
  const adapter = setupAdapter();
  const policy = new PolicyEngine({
    allowWrites: false,
  });

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: unauthorized-write
spec:
  steps:
    - id: write
      tool: cluster.scale_pods
      arguments:
        replicas: 10
  output:
    include:
      - write
`;
  const { plan } = parsePlan(planYaml);
  await assert.rejects(
    () => policy.validatePreExecution(plan, adapter),
    (err: unknown) =>
      err instanceof PolicyViolationError &&
      err.message.includes("Write operation 'cluster.scale_pods' denied")
  );
});

test("PolicyEngine blocks disallowed permission requested by plan", async () => {
  const adapter = setupAdapter();
  const policy = new PolicyEngine({
    allowedPermissions: new Set(["cluster.read"]),
  });

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: bad-perm
spec:
  permissions:
    - cluster.admin
  steps:
    - id: read
      tool: cluster.read_status
  output:
    include:
      - read
`;
  const { plan } = parsePlan(planYaml);
  await assert.rejects(
    () => policy.validatePreExecution(plan, adapter),
    (err: unknown) =>
      err instanceof PolicyViolationError &&
      err.message.includes("permission 'cluster.admin'")
  );
});
