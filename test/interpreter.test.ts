import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";
import { Interpreter } from "../src/interpreter.js";

const setupTestAdapter = () => {
  const adapter = new InMemoryToolAdapter();
  adapter.registerTool({
    capability: {
      name: "kubernetes.get_deployment",
      type: "read",
    },
    handler: (args) => ({
      name: args.name,
      replicas: 3,
      status: "Running",
    }),
  });

  adapter.registerTool({
    capability: {
      name: "kubernetes.get_logs",
      type: "read",
    },
    handler: (args) => ({
      deployment: args.deployment,
      logs: `Logs for ${args.deployment}: System operational.`,
    }),
  });

  adapter.registerTool({
    capability: {
      name: "faulty.tool",
      type: "read",
    },
    handler: () => {
      throw new Error("Simulated backend crash");
    },
  });

  return adapter;
};

test("Interpreter executes deterministic multi-step plan successfully", async () => {
  const adapter = setupTestAdapter();
  const interpreter = new Interpreter(adapter);

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: test-flow
spec:
  steps:
    - id: deployment
      tool: kubernetes.get_deployment
      arguments:
        name: payments-api
    - id: logs
      tool: kubernetes.get_logs
      dependsOn:
        - deployment
      arguments:
        deployment:
          from: deployment
          path: name
  output:
    include:
      - deployment
      - logs
`;

  const { receipt, outputs } = await interpreter.execute(planYaml);

  assert.equal(receipt.status, "complete");
  assert.equal(receipt.steps["deployment"]?.status, "success");
  assert.equal(receipt.steps["logs"]?.status, "success");
  assert.deepEqual(outputs["deployment"], {
    name: "payments-api",
    replicas: 3,
    status: "Running",
  });
  assert.deepEqual(outputs["logs"], {
    deployment: "payments-api",
    logs: "Logs for payments-api: System operational.",
  });
  assert.ok(receipt.timestamps.durationMs >= 0);
  assert.ok(receipt.metrics.totalBytesProcessed > 0);
});

test("Interpreter skips downstream steps when upstream step fails", async () => {
  const adapter = setupTestAdapter();
  const interpreter = new Interpreter(adapter);

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: failure-isolation
spec:
  steps:
    - id: fail_step
      tool: faulty.tool
    - id: dependent_step
      tool: kubernetes.get_logs
      dependsOn:
        - fail_step
      arguments:
        deployment:
          from: fail_step
          path: missing
  output:
    include:
      - fail_step
`;

  const { receipt } = await interpreter.execute(planYaml);

  assert.equal(receipt.status, "failed");
  assert.equal(receipt.steps["fail_step"]?.status, "failed");
  assert.equal(receipt.steps["dependent_step"]?.status, "skipped");
  assert.equal(receipt.steps["dependent_step"]?.attempts, 0);
});

test("Interpreter pauses and returns handback when step requires judgment", async () => {
  const adapter = setupTestAdapter();
  const interpreter = new Interpreter(adapter);

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: judgment-flow
spec:
  steps:
    - id: deployment
      tool: kubernetes.get_deployment
      arguments:
        name: payments-api
    - id: evaluate_anomalies
      tool: kubernetes.get_logs
      dependsOn:
        - deployment
      requiresJudgment: true
      arguments:
        deployment:
          from: deployment
          path: name
  output:
    include:
      - deployment
`;

  const { receipt, outputs } = await interpreter.execute(planYaml);

  assert.equal(receipt.status, "incomplete");
  assert.equal(receipt.handback?.reason, "requiresJudgment");
  assert.equal(receipt.handback?.stepId, "evaluate_anomalies");
  assert.equal(receipt.steps["deployment"]?.status, "success");
  assert.equal(receipt.steps["evaluate_anomalies"]?.status, "skipped");
  assert.ok(outputs["deployment"]);
});
