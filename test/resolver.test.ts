import test from "node:test";
import assert from "node:assert/strict";
import { extractPath, resolveArguments, ResolutionError } from "../src/resolver.js";

test("extractPath resolves nested object and array paths", () => {
  const source = {
    service: {
      endpoints: [{ id: "ep-1", host: "10.0.0.1" }, { id: "ep-2", host: "10.0.0.2" }],
    },
  };

  assert.equal(extractPath(source, "service.endpoints.1.host"), "10.0.0.2");
  assert.equal(extractPath(source, "service.endpoints.0.id"), "ep-1");
  assert.deepEqual(extractPath(source, "."), source);
});

test("extractPath throws ResolutionError for non-existent field", () => {
  const source = { a: { b: 1 } };
  assert.throws(
    () => extractPath(source, "a.c"),
    (err: unknown) =>
      err instanceof ResolutionError && err.message.includes("Field 'c' not found")
  );
});

test("resolveArguments substitutes step references correctly without mutation", () => {
  const rawArgs = {
    cluster: "prod-us",
    target: {
      from: "step1",
      path: "items.0.name",
    },
    nested: {
      count: 5,
      endpoint: {
        from: "step2",
        path: "url",
      },
    },
  };

  const outputs = new Map<string, unknown>([
    ["step1", { items: [{ name: "auth-service" }] }],
    ["step2", { url: "https://auth.internal" }],
  ]);

  const resolved = resolveArguments(rawArgs, outputs);

  assert.deepEqual(resolved, {
    cluster: "prod-us",
    target: "auth-service",
    nested: {
      count: 5,
      endpoint: "https://auth.internal",
    },
  });

  assert.equal(
    typeof (rawArgs.target as Record<string, unknown>).from,
    "string"
  );
});
