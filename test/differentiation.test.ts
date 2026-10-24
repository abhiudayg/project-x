import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";
import { Interpreter } from "../src/interpreter.js";
import { PolicyViolationError } from "../src/policy.js";
import { ValidationError } from "../src/parser.js";

test("Differentiation Test 1 (Pre-execution validation): Rejects before any side effect occurs", async () => {
  const executedSteps: string[] = [];
  const adapter = new InMemoryToolAdapter();

  adapter.registerTool({
    capability: { name: "service.step1", type: "read" },
    handler: () => {
      executedSteps.push("step1");
      return { ok: true };
    },
  });

  adapter.registerTool({
    capability: { name: "service.step2", type: "read" },
    handler: () => {
      executedSteps.push("step2");
      return { ok: true };
    },
  });

  adapter.registerTool({
    capability: { name: "service.step3", type: "read" },
    handler: () => {
      executedSteps.push("step3");
      return { ok: true };
    },
  });

  const interpreter = new Interpreter(adapter);

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: pre-exec-test
spec:
  steps:
    - id: s1
      tool: service.step1
    - id: s2
      tool: service.step2
      dependsOn: [s1]
    - id: s3
      tool: service.step3
      dependsOn: [s2]
    - id: s4
      tool: service.non_existent_tool
      dependsOn: [s3]
    - id: s5
      tool: service.step1
      dependsOn: [s4]
  output:
    include: [s5]
`;

  await assert.rejects(
    () => interpreter.execute(planYaml),
    (err: unknown) =>
      err instanceof PolicyViolationError &&
      err.message.includes("Unknown tool 'service.non_existent_tool'")
  );

  assert.equal(
    executedSteps.length,
    0,
    "Steps 1-3 must not have executed before pre-execution failure"
  );
});

test("Differentiation Test 2 (Per-call policy at tool boundary): Attempted out-of-scope write blocked", async () => {
  const adapter = new InMemoryToolAdapter();
  adapter.registerTool({
    capability: { name: "db.read", type: "read" },
    handler: () => ({ row: 1 }),
  });
  adapter.registerTool({
    capability: { name: "db.delete", type: "write" },
    handler: () => ({ deleted: true }),
  });

  const interpreter = new Interpreter(adapter, {
    policy: {
      allowedTools: new Set(["db.read"]),
      allowWrites: false,
    },
  });

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: tool-boundary-test
spec:
  steps:
    - id: delete_row
      tool: db.delete
  output:
    include: [delete_row]
`;

  await assert.rejects(
    () => interpreter.execute(planYaml),
    (err: unknown) => err instanceof PolicyViolationError
  );
});

test("Differentiation Test 3 (Write gating without execution): Zero steps run when write not granted", async () => {
  const executedSteps: string[] = [];
  const adapter = new InMemoryToolAdapter();

  adapter.registerTool({
    capability: { name: "infra.read_config", type: "read" },
    handler: () => {
      executedSteps.push("read_config");
      return { config: "val" };
    },
  });

  adapter.registerTool({
    capability: { name: "infra.write_config", type: "write" },
    handler: () => {
      executedSteps.push("write_config");
      return { updated: true };
    },
  });

  const interpreter = new Interpreter(adapter, {
    policy: {
      allowWrites: false,
    },
  });

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: write-gating-test
spec:
  steps:
    - id: read
      tool: infra.read_config
    - id: write
      tool: infra.write_config
      dependsOn: [read]
  output:
    include: [write]
`;

  await assert.rejects(
    () => interpreter.execute(planYaml),
    (err: unknown) =>
      err instanceof PolicyViolationError &&
      err.message.includes("Write operation 'infra.write_config' denied")
  );

  assert.equal(
    executedSteps.length,
    0,
    "No steps (even read steps) execute when plan contains an unauthorized write"
  );
});

test("Differentiation Test 4 (Structured queryable record): Audit questions answered from receipt alone", async () => {
  const adapter = new InMemoryToolAdapter();
  adapter.registerTool({
    capability: { name: "audit.read_logs", type: "read" },
    handler: () => ({ logs: "user login at 10:00" }),
  });

  const interpreter = new Interpreter(adapter);

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: audit-receipt-test
spec:
  steps:
    - id: logs
      tool: audit.read_logs
      arguments:
        filter: "login"
  output:
    include: [logs]
`;

  const { receipt } = await interpreter.execute(planYaml);

  assert.ok(receipt.planDigest);
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.steps["logs"]?.status, "success");
  assert.equal(typeof receipt.steps["logs"]?.argumentHash, "string");
  assert.ok(receipt.steps["logs"]!.argumentHash.length === 64);
  assert.equal(receipt.policyDecisions[0]?.decision, "granted");
  assert.ok(receipt.metrics.totalBytesProcessed > 0);
  assert.ok(typeof receipt.metrics.interpreterOverheadMs === "number");
});

test("Differentiation Test 5 (Bounded side effects on failure): Mid-workflow timeout skips downstream steps", async () => {
  const adapter = new InMemoryToolAdapter();
  let step1Executed = false;
  let step3Executed = false;

  adapter.registerTool({
    capability: { name: "task.step1", type: "read" },
    handler: () => {
      step1Executed = true;
      return { data: 123 };
    },
  });

  adapter.registerTool({
    capability: { name: "task.timeout_step", type: "read" },
    handler: async (_args, signal) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Step aborted due to timeout"));
        });
      });
      return { ok: true };
    },
  });

  adapter.registerTool({
    capability: { name: "task.step3", type: "read" },
    handler: () => {
      step3Executed = true;
      return { done: true };
    },
  });

  const interpreter = new Interpreter(adapter);

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: timeout-test
spec:
  steps:
    - id: s1
      tool: task.step1
    - id: s2
      tool: task.timeout_step
      dependsOn: [s1]
      timeoutMs: 50
    - id: s3
      tool: task.step3
      dependsOn: [s2]
  output:
    include: [s3]
`;

  const { receipt } = await interpreter.execute(planYaml);

  assert.equal(receipt.status, "failed");
  assert.ok(step1Executed);
  assert.equal(receipt.steps["s1"]?.status, "success");
  assert.equal(receipt.steps["s2"]?.status, "timed_out");
  assert.equal(receipt.steps["s3"]?.status, "skipped");
  assert.equal(step3Executed, false, "Step 3 must be skipped");
});
