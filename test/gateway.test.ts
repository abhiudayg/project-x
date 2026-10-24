import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";
import { MCPGatewayProxy } from "../src/proxy/mcp-gateway.js";

const setupGateway = () => {
  const adapter = new InMemoryToolAdapter();

  adapter.registerTool({
    capability: { name: "db.query", type: "read", description: "Query database" },
    handler: (args) => ({ rows: [{ id: 1, name: args.table }] }),
  });

  adapter.registerTool({
    capability: { name: "cache.set", type: "write", description: "Write cache" },
    handler: (args) => ({ cached: args.key }),
  });

  const gateway = new MCPGatewayProxy(adapter, {
    policy: { allowWrites: false },
  });

  return { adapter, gateway };
};

test("MCPGatewayProxy lists upstream tools and injects 'x_execute_plan' meta-tool", async () => {
  const { gateway } = setupGateway();
  const tools = await gateway.listTools();

  assert.equal(tools.length, 3);
  assert.ok(tools.some((t) => t.name === "db.query"));
  assert.ok(tools.some((t) => t.name === "cache.set"));

  const xTool = tools.find((t) => t.name === "x_execute_plan")!;
  assert.ok(xTool);
  assert.equal(xTool.name, "x_execute_plan");
  assert.ok(xTool.description?.includes("declarative multi-tool execution plan"));
});

test("MCPGatewayProxy passes through standard tool calls directly", async () => {
  const { gateway } = setupGateway();
  const res = await gateway.callTool("db.query", { table: "users" });

  assert.equal(res.isError, false);
  assert.ok(res.content[0]?.text?.includes("users"));
});

test("MCPGatewayProxy intercepts 'x_execute_plan' and returns receipt", async () => {
  const { gateway } = setupGateway();
  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: proxy-test
spec:
  steps:
    - id: query_step
      tool: db.query
      arguments:
        table: accounts
  output:
    include: [query_step]
`;

  const res = await gateway.callTool("x_execute_plan", { plan: planYaml });

  assert.equal(res.isError, false);
  const parsed = JSON.parse(res.content[0]!.text!);
  assert.equal(parsed.receipt.status, "complete");
  assert.ok(parsed.outputs["query_step"]);
});

test("MCPGatewayProxy rejects unauthorized write in plan at pre-execution gate", async () => {
  const { gateway } = setupGateway();
  const badPlanYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: bad-write
spec:
  steps:
    - id: mutate
      tool: cache.set
      arguments:
        key: session
  output:
    include: [mutate]
`;

  const res = await gateway.callTool("x_execute_plan", { plan: badPlanYaml });

  assert.equal(res.isError, true);
  assert.ok(res.content[0]?.text?.includes("Write operation 'cache.set' denied"));
});

test("MCPGatewayProxy handles JSON-RPC 2.0 requests", async () => {
  const { gateway } = setupGateway();

  const listReq = { id: 1, method: "tools/list" };
  const listRes = (await gateway.handleJsonRpc(listReq)) as {
    result: { tools: unknown[] };
  };
  assert.equal(listRes.result.tools.length, 3);

  const callReq = {
    id: 2,
    method: "tools/call",
    params: { name: "db.query", arguments: { table: "orders" } },
  };
  const callRes = (await gateway.handleJsonRpc(callReq)) as {
    result: { isError: boolean; content: Array<{ text: string }> };
  };
  assert.equal(callRes.result.isError, false);
  assert.ok(callRes.result.content[0]?.text.includes("orders"));
});
