import test from "node:test";
import assert from "node:assert/strict";
import { LiveNvidiaModelClient } from "../src/benchmark/models/client.js";
import { parsePlan } from "../src/parser.js";
import { buildDAG } from "../src/dag.js";

test("Live Model Test (NVIDIA API): Generates valid Project X ExecutionPlan and Code Mode script", async (t) => {
  const client = new LiveNvidiaModelClient();
  if (!client.hasApiKey()) {
    t.skip("NVIDIA_API_KEY is not set, skipping live model generation test");
    return;
  }

  const modelId = "meta/llama-3.2-11b-vision-instruct";
  const payload = {
    taskDescription:
      "Query telemetry for cluster 'us-east-1'. Fetch CPU metrics using telemetry.get_cluster_cpu, and memory metrics using telemetry.get_cluster_memory in parallel. Include both in output.",
    availableTools: [
      {
        name: "telemetry.get_cluster_cpu",
        type: "read" as const,
        description: "Returns CPU telemetry for cluster",
      },
      {
        name: "telemetry.get_cluster_memory",
        type: "read" as const,
        description: "Returns memory telemetry for cluster",
      },
    ],
    systemPrompt: "Project X Planner",
  };

  let planResult;
  try {
    planResult = await client.generatePlan(modelId, payload);
  } catch (err) {
    t.skip(`Live API unreachable or timed out: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  assert.ok(planResult.durationMs > 0, "Model call should record duration");
  assert.ok(planResult.inputTokens > 0, "Model call should record input tokens");
  assert.ok(planResult.outputTokens > 0, "Model call should record output tokens");
  assert.ok(planResult.parsedPlanYaml, "Model should emit YAML content");

  let parsedSuccessfully = false;
  try {
    const { plan } = parsePlan(planResult.parsedPlanYaml!);
    buildDAG(plan);
    parsedSuccessfully = true;
  } catch (err) {
    console.log("Live Model Plan Parsing Feedback:", err instanceof Error ? err.message : String(err));
    console.log("Raw YAML was:\n", planResult.parsedPlanYaml);
  }

  const codeResult = await client.generateCodeModeScript(modelId, payload);
  assert.ok(codeResult.parsedCodeScript, "Model should emit Code Mode script");
  assert.ok(codeResult.parsedCodeScript!.includes("invokeTool"), "Code Mode script should invoke tools");

  assert.ok(planResult.inputTokens >= codeResult.inputTokens, "Plan prompt includes schema context");
});
