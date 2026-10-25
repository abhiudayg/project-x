import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";
import { ProjectXClient } from "../src/integrations/client.js";
import { createProjectXLangChainTool } from "../src/integrations/langchain.js";

test("ProjectXClient validates valid and invalid plans without side effects", () => {
  const adapter = new InMemoryToolAdapter();
  const client = new ProjectXClient(adapter);

  const validYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: valid-plan
spec:
  steps:
    - id: step-1
      tool: test.tool
      arguments: {}
  output:
    include:
      - step-1
`;
  const validRes = client.validatePlan(validYaml);
  assert.equal(validRes.valid, true);
  assert.equal(validRes.plan.metadata.name, "valid-plan");
  assert.equal(validRes.errors.length, 0);

  const invalidYaml = `
apiVersion: x.dev/v999
kind: ExecutionPlan
metadata:
  name: invalid-plan
spec:
  steps: []
`;
  const invalidRes = client.validatePlan(invalidYaml);
  assert.equal(invalidRes.valid, false);
  assert.ok(invalidRes.errors.length > 0);
});

test("ProjectXClient executes multi-step plan and resolves outputs", async () => {
  const adapter = new InMemoryToolAdapter();
  adapter.registerTool({
    capability: { name: "geo.lookup", type: "read" },
    handler: async () => ({ city: "Seattle", lat: 47.6, lon: -122.3 }),
  });
  adapter.registerTool({
    capability: { name: "weather.forecast", type: "read" },
    handler: async (args) => ({ city: args.city, tempF: 62 }),
  });

  const client = new ProjectXClient(adapter);
  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: weather-check
spec:
  steps:
    - id: get-geo
      tool: geo.lookup
      arguments: {}
    - id: get-weather
      tool: weather.forecast
      dependsOn:
        - get-geo
      arguments:
        city: $steps.get-geo.output.city
  output:
    include:
      - get-weather
`;

  const { receipt, outputs } = await client.executePlan(planYaml);
  assert.equal(receipt.status, "complete");
  assert.equal((outputs["get-weather"] as { tempF: number }).tempF, 62);
});

test("createProjectXLangChainTool exposes callable tool definition conforming to standard tool schema", async () => {
  const adapter = new InMemoryToolAdapter();
  adapter.registerTool({
    capability: { name: "echo.tool", type: "read" },
    handler: async (args) => ({ echoed: args.message }),
  });

  const client = new ProjectXClient(adapter);
  const tool = createProjectXLangChainTool(client);

  assert.equal(tool.name, "x_execute_plan");
  assert.ok(tool.description.includes("ExecutionPlan"));
  assert.equal(tool.schema.required[0], "planYaml");

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: echo-plan
spec:
  steps:
    - id: echo-step
      tool: echo.tool
      arguments:
        message: "hello agent"
  output:
    include:
      - echo-step
`;

  const responseJson = await tool.call({ planYaml });
  const response = JSON.parse(responseJson);

  assert.equal(response.status, "complete");
  assert.equal(response.outputs["echo-step"].echoed, "hello agent");
});

test("ProjectXClient handles requiresJudgment pause and resumePlan", async () => {
  const adapter = new InMemoryToolAdapter();
  adapter.registerTool({
    capability: { name: "triage.alert", type: "read" },
    handler: async () => ({ severity: "critical", alertId: "alt-1" }),
  });
  adapter.registerTool({
    capability: { name: "action.quarantine", type: "write" },
    handler: async (args) => ({ quarantined: true, reason: args.reason }),
  });

  const client = new ProjectXClient(adapter, { policy: { allowWrites: true } });

  const triagePlan = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: triage-workflow
spec:
  steps:
    - id: step-alert
      tool: triage.alert
      arguments: {}
    - id: step-action
      tool: action.quarantine
      dependsOn:
        - step-alert
      requiresJudgment: true
      arguments:
        alertId: $steps.step-alert.output.alertId
  output:
    include:
      - step-alert
      - step-action
`;

  const initial = await client.executePlan(triagePlan);
  assert.equal(initial.receipt.status, "incomplete");
  assert.equal(initial.receipt.handback?.stepId, "step-action");
  assert.equal(initial.receipt.handback?.reason, "requiresJudgment");
  assert.equal(initial.receipt.steps["step-action"].status, "skipped");

  const resumed = await client.resumePlan(triagePlan, initial.receipt, {
    reason: "confirmed-threat",
  });

  assert.equal(resumed.receipt.status, "complete");
  assert.equal((resumed.outputs["step-action"] as { reason: string }).reason, "confirmed-threat");
});
