import test from "node:test";
import assert from "node:assert/strict";
import { Verifier } from "../src/verifier.js";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";

test("Verifier returns 'unverified' when tool has no verification capability", async () => {
  const adapter = new InMemoryToolAdapter();
  adapter.registerTool({
    capability: {
      name: "kv.get",
      type: "read",
    },
    handler: () => ({ val: 1 }),
  });

  const tool = (await adapter.getTool("kv.get"))!;
  const status = await Verifier.evaluateStep(tool, { val: 1 }, {}, adapter);
  assert.equal(status, "unverified");
});

test("Verifier returns 'verified' when declared verification read-back matches", async () => {
  const store = new Map<string, string>();
  const adapter = new InMemoryToolAdapter();

  adapter.registerTool({
    capability: {
      name: "kv.read",
      type: "read",
    },
    handler: (args) => ({ value: store.get(String(args.key)) }),
  });

  adapter.registerTool({
    capability: {
      name: "kv.write",
      type: "write",
      verificationTool: "kv.read",
    },
    handler: (args) => {
      store.set(String(args.key), String(args.value));
      return { value: String(args.value) };
    },
  });

  const tool = (await adapter.getTool("kv.write"))!;
  const stepResult = { value: "gold" };
  const resolvedArgs = { key: "item", value: "gold" };

  store.set("item", "gold");
  const status = await Verifier.evaluateStep(
    tool,
    stepResult,
    resolvedArgs,
    adapter
  );
  assert.equal(status, "verified");
});

test("Verifier returns 'failed' when read-back result mismatches", async () => {
  const adapter = new InMemoryToolAdapter();

  adapter.registerTool({
    capability: {
      name: "kv.read",
      type: "read",
    },
    handler: () => ({ value: "corrupted" }),
  });

  adapter.registerTool({
    capability: {
      name: "kv.write",
      type: "write",
      verificationTool: "kv.read",
    },
    handler: (args) => ({ value: args.value }),
  });

  const tool = (await adapter.getTool("kv.write"))!;
  const status = await Verifier.evaluateStep(
    tool,
    { value: "expected" },
    { key: "item", value: "expected" },
    adapter
  );
  assert.equal(status, "failed");
});
