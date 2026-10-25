import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditTrace,
  compileTraceToPlan,
  normalizeTrace,
  calculateAuditSavings,
} from "../src/audit.js";
import { buildDAG } from "../src/dag.js";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";
import { MCPGatewayProxy } from "../src/proxy/mcp-gateway.js";

test("normalizeTrace parses standard trace object with turns", () => {
  const raw = {
    name: "test-pipeline",
    turns: [
      {
        tool: "fetch_clusters",
        arguments: { region: "us-east-1" },
        output: { clusterId: "cls-999" },
      },
    ],
  };

  const normalized = normalizeTrace(raw);
  assert.equal(normalized.name, "test-pipeline");
  assert.equal(normalized.turns.length, 1);
  assert.equal(normalized.turns[0].tool, "fetch_clusters");
});

test("normalizeTrace parses raw array of turns", () => {
  const raw = [
    { tool: "step_one", arguments: {} },
    { tool: "step_two", arguments: {} },
  ];

  const normalized = normalizeTrace(raw);
  assert.equal(normalized.turns.length, 2);
  assert.equal(normalized.turns[0].tool, "step_one");
  assert.equal(normalized.turns[1].tool, "step_two");
});

test("normalizeTrace parses OpenAI message history format", () => {
  const raw = {
    messages: [
      { role: "user", content: "Check deployment status" },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_abc123",
            type: "function",
            function: {
              name: "get_deployment",
              arguments: JSON.stringify({ appId: "app-42" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_abc123",
        content: JSON.stringify({ deploymentId: "dep-777", status: "degraded" }),
      },
      {
        role: "assistant",
        tool_calls: [
          {
            id: "call_def456",
            type: "function",
            function: {
              name: "fetch_logs",
              arguments: JSON.stringify({ deploymentId: "dep-777" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_def456",
        content: JSON.stringify({ logs: ["error: out of memory"] }),
      },
    ],
  };

  const normalized = normalizeTrace(raw);
  assert.equal(normalized.turns.length, 2);
  assert.equal(normalized.turns[0].tool, "get_deployment");
  assert.equal(normalized.turns[1].tool, "fetch_logs");
  assert.deepEqual(normalized.turns[1].arguments, { deploymentId: "dep-777" });
});

test("compileTraceToPlan extracts dependencies and matches variables into StepReferences", () => {
  const trace = {
    name: "incident-triage",
    turns: [
      {
        id: "step_deployments",
        tool: "list_deployments",
        arguments: { env: "prod" },
        output: { primaryDeploymentId: "dep-101", region: "us-west-2" },
      },
      {
        id: "step_logs",
        tool: "fetch_logs",
        arguments: {
          deploymentId: "dep-101",
          level: "error",
        },
        output: { errorFound: true },
      },
      {
        id: "step_restart",
        tool: "restart_service",
        arguments: { targetEnv: "prod" },
        output: { restarted: true },
      },
    ],
  };

  const plan = compileTraceToPlan(normalizeTrace(trace));
  assert.equal(plan.apiVersion, "x.dev/v1alpha1");
  assert.equal(plan.kind, "ExecutionPlan");
  assert.equal(plan.metadata.name, "incident-triage");
  assert.equal(plan.spec.steps.length, 3);

  const stepLogs = plan.spec.steps[1];
  assert.deepEqual(stepLogs.dependsOn, ["step_deployments"]);
  assert.deepEqual(stepLogs.arguments.deploymentId, {
    from: "step_deployments",
    path: "primaryDeploymentId",
  });

  const stepRestart = plan.spec.steps[2];
  assert.ok(plan.spec.permissions.includes("tools:restart_service:write"));
  assert.ok(plan.spec.permissions.includes("tools:list_deployments:read"));

  const dag = buildDAG(plan);
  assert.ok(dag.topologicalOrder.indexOf("step_deployments") < dag.topologicalOrder.indexOf("step_logs"));
});

test("calculateAuditSavings computes realistic token, round-trip, and cost reductions", () => {
  const trace = normalizeTrace([
    { tool: "step_1", arguments: {}, output: { val: 1 } },
    { tool: "step_2", arguments: {}, output: { val: 2 } },
    { tool: "step_3", arguments: {}, output: { val: 3 } },
    { tool: "step_4", arguments: {}, output: { val: 4 } },
  ]);

  const savings = calculateAuditSavings(trace);
  assert.equal(savings.baselineRoundTrips, 5);
  assert.equal(savings.projectXRoundTrips, 1);
  assert.equal(savings.roundTripsSaved, 4);
  assert.ok(savings.tokensSaved > 0);
  assert.ok(savings.tokenSavingsPercentage > 30);
  assert.ok(savings.costSavingsUsd > 0);
  assert.equal(savings.estimatedLatencyReductionMs, 4 * 1400);
});

test("auditTrace generates a complete markdown report and valid plan", () => {
  const trace = {
    name: "cloud-audit",
    turns: [
      { tool: "scan_ports", arguments: { host: "10.0.0.1" }, output: { open: [80, 443] } },
      { tool: "verify_cert", arguments: { port: 443 }, output: { valid: true } },
    ],
  };

  const report = auditTrace(trace);
  assert.equal(report.traceName, "cloud-audit");
  assert.ok(report.planYaml.includes("apiVersion: x.dev/v1alpha1"));
  assert.ok(report.markdownSummary.includes("Project X Agent Audit Report"));
  assert.ok(report.markdownSummary.includes("Model Round Trips"));
  assert.equal(report.security.readTools.length, 2);
  assert.equal(report.security.writeTools.length, 0);
});

test("MCPGatewayProxy provides x_audit_trace tool", async () => {
  const adapter = new InMemoryToolAdapter();
  const gateway = new MCPGatewayProxy(adapter, { enableAuditTool: true });

  const tools = await gateway.listTools();
  assert.ok(tools.some((t) => t.name === "x_audit_trace"));

  const tracePayload = {
    name: "gateway-trace-test",
    turns: [
      { tool: "lookup_user", arguments: { id: "u-1" }, output: { email: "u@test.com" } },
    ],
  };

  const response = await gateway.callTool("x_audit_trace", { trace: tracePayload });
  assert.equal(response.isError, false);
  assert.ok(response.content[0].text);

  const parsedReport = JSON.parse(response.content[0].text);
  assert.equal(parsedReport.traceName, "gateway-trace-test");
  assert.equal(parsedReport.generatedPlan.spec.steps.length, 1);
});
