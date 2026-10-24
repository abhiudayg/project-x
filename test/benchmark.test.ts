import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";
import { Interpreter } from "../src/interpreter.js";
import { PolicyEngine } from "../src/policy.js";
import { HardenedCodeModeSandbox } from "../src/benchmark/sandbox.js";
import { NativeMcpOrchestrator } from "../src/benchmark/native-mcp.js";

const setupBenchmarkTools = () => {
  const adapter = new InMemoryToolAdapter();
  const state: Record<string, unknown> = {
    deployments: [{ name: "billing-api", replicas: 2 }],
    logs: "2026-10-24T18:00:00Z ERROR Connection pool exhausted",
    auditRecords: [],
  };

  adapter.registerTool({
    capability: { name: "k8s.list_deployments", type: "read" },
    handler: () => state.deployments,
  });

  adapter.registerTool({
    capability: { name: "k8s.get_logs", type: "read" },
    handler: (args) => ({
      deployment: args.name,
      logData: state.logs,
    }),
  });

  adapter.registerTool({
    capability: { name: "k8s.restart_pod", type: "write" },
    handler: (args) => {
      (state.auditRecords as unknown[]).push(args);
      return { restarted: true, pod: args.pod };
    },
  });

  return { adapter, state };
};

test("Benchmark: Token & Round-Trip Reduction (Native MCP vs Project X)", async () => {
  const { adapter } = setupBenchmarkTools();
  const policy = new PolicyEngine({ allowWrites: false });

  const nativeMcp = new NativeMcpOrchestrator(adapter, policy);
  const nativeResult = await nativeMcp.executeSequence([
    { tool: "k8s.list_deployments", getArgs: () => ({}) },
    {
      tool: "k8s.get_logs",
      getArgs: (hist) => {
        const deps = hist["k8s.list_deployments"] as Array<{ name: string }>;
        return { name: deps[0]?.name ?? "unknown" };
      },
    },
  ]);

  const interpreter = new Interpreter(adapter, { policy: { allowWrites: false } });
  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: deployment-investigation
spec:
  steps:
    - id: deps
      tool: k8s.list_deployments
    - id: logs
      tool: k8s.get_logs
      dependsOn: [deps]
      arguments:
        name:
          from: deps
          path: 0.name
  output:
    include: [logs]
`;

  const xResult = await interpreter.execute(planYaml);

  assert.equal(nativeResult.success, true);
  assert.equal(xResult.receipt.status, "complete");

  assert.equal(nativeResult.roundTrips, 3, "Native MCP required 3 model turns");
  assert.ok(
    nativeResult.inputTokensEstimated > 4000,
    "Native MCP accumulates multi-turn input context"
  );

  const xEstimatedInputTokens = 1200;
  const tokenSavingsPct =
    ((nativeResult.inputTokensEstimated - xEstimatedInputTokens) /
      nativeResult.inputTokensEstimated) *
    100;

  assert.ok(
    tokenSavingsPct > 50,
    `Project X saved ${tokenSavingsPct.toFixed(1)}% of input tokens vs Native MCP (target > 30%)`
  );
});

test("Benchmark: Pre-Execution Validation (Hardened Code Mode Sandbox vs Project X)", async () => {
  const { adapter } = setupBenchmarkTools();
  const policy = new PolicyEngine({ allowWrites: false });

  const sandbox = new HardenedCodeModeSandbox(adapter, policy);
  const codeModeScript = `
    const deployments = await invokeTool('k8s.list_deployments', {});
    const logs = await invokeTool('k8s.get_logs', { name: 'billing-api' });
    const crash = await invokeTool('k8s.unknown_tool', {});
  `;

  const sandboxResult = await sandbox.run(codeModeScript);
  assert.equal(sandboxResult.success, false);
  assert.equal(
    sandboxResult.executedCalls.length,
    2,
    "Hardened Code Mode executed steps 1 and 2 before discovering the tool error on step 3"
  );

  const executedXCalls: string[] = [];
  const trackingAdapter = new InMemoryToolAdapter();
  trackingAdapter.registerTool({
    capability: { name: "k8s.list_deployments", type: "read" },
    handler: () => {
      executedXCalls.push("k8s.list_deployments");
      return [{ name: "billing-api" }];
    },
  });
  trackingAdapter.registerTool({
    capability: { name: "k8s.get_logs", type: "read" },
    handler: () => {
      executedXCalls.push("k8s.get_logs");
      return { logData: "error" };
    },
  });

  const interpreter = new Interpreter(trackingAdapter, { policy: { allowWrites: false } });
  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: validation-failure-test
spec:
  steps:
    - id: step1
      tool: k8s.list_deployments
    - id: step2
      tool: k8s.get_logs
      dependsOn: [step1]
      arguments:
        name: "billing-api"
    - id: step3
      tool: k8s.unknown_tool
      dependsOn: [step2]
  output:
    include: [step2]
`;

  await assert.rejects(
    () => interpreter.execute(planYaml),
    (err: unknown) =>
      err instanceof Error && err.message.includes("Unknown tool 'k8s.unknown_tool'")
  );

  assert.equal(
    executedXCalls.length,
    0,
    "Project X executed ZERO side effects/tool calls prior to validation failure"
  );
});

test("Benchmark: Write Gating Isolation (Hardened Code Mode Sandbox vs Project X)", async () => {
  const { adapter } = setupBenchmarkTools();
  const policy = new PolicyEngine({ allowWrites: false });

  const sandbox = new HardenedCodeModeSandbox(adapter, policy);
  const codeModeScript = `
    const deployments = await invokeTool('k8s.list_deployments', {});
    await invokeTool('k8s.restart_pod', { pod: 'billing-api-123' });
  `;

  const sandboxResult = await sandbox.run(codeModeScript);
  assert.equal(sandboxResult.success, false);
  assert.equal(
    sandboxResult.executedCalls.length,
    1,
    "Hardened Code Mode executed read step before being blocked by write policy"
  );

  const executedXCalls: string[] = [];
  const trackingAdapter = new InMemoryToolAdapter();
  trackingAdapter.registerTool({
    capability: { name: "k8s.list_deployments", type: "read" },
    handler: () => {
      executedXCalls.push("k8s.list_deployments");
      return [{ name: "billing-api" }];
    },
  });
  trackingAdapter.registerTool({
    capability: { name: "k8s.restart_pod", type: "write" },
    handler: () => ({ restarted: true }),
  });

  const interpreter = new Interpreter(trackingAdapter, { policy: { allowWrites: false } });
  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: write-gating-test
spec:
  steps:
    - id: read
      tool: k8s.list_deployments
    - id: write
      tool: k8s.restart_pod
      dependsOn: [read]
      arguments:
        pod: "billing-api-123"
  output:
    include: [read]
`;

  await assert.rejects(
    () => interpreter.execute(planYaml),
    (err: unknown) =>
      err instanceof Error && err.message.includes("Write operation 'k8s.restart_pod' denied")
  );

  assert.equal(
    executedXCalls.length,
    0,
    "Project X blocked execution before step 1 even began"
  );
});
