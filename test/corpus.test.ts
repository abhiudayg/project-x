import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";
import { Interpreter } from "../src/interpreter.js";
import { ValidationError } from "../src/parser.js";
import { PolicyViolationError } from "../src/policy.js";

const setupCorpusAdapter = () => {
  const adapter = new InMemoryToolAdapter();

  adapter.registerTool({
    capability: { name: "telemetry.get_cluster_cpu", type: "read" },
    handler: (args) => ({ cluster: args.cluster, usagePct: 42.5 }),
  });
  adapter.registerTool({
    capability: { name: "telemetry.get_cluster_memory", type: "read" },
    handler: (args) => ({ cluster: args.cluster, usedGb: 64, totalGb: 128 }),
  });
  adapter.registerTool({
    capability: { name: "telemetry.get_cluster_disk", type: "read" },
    handler: (args) => ({ cluster: args.cluster, iops: 1250 }),
  });

  adapter.registerTool({
    capability: { name: "network.resolve_dns", type: "read" },
    handler: (args) => ({ domain: args.domain, ip: "192.0.2.1", resolver: args.resolver }),
  });

  adapter.registerTool({
    capability: { name: "service_catalog.query", type: "read" },
    handler: (args) => ({ domain: args.domain, services: ["svc-1", "svc-2"] }),
  });

  adapter.registerTool({
    capability: { name: "tenant.get_by_slug", type: "read" },
    handler: (args) => ({ slug: args.slug, customerId: "cust_998811" }),
  });
  adapter.registerTool({
    capability: { name: "billing.list_subscriptions", type: "read" },
    handler: (args) => ({ customerId: args.customerId, activePlan: "enterprise" }),
  });
  adapter.registerTool({
    capability: { name: "billing.list_invoices", type: "read" },
    handler: (args) => ({ customerId: args.customerId, count: 2 }),
  });

  adapter.registerTool({
    capability: { name: "git.get_branch_head", type: "read" },
    handler: () => ({ sha: "7831858abcd" }),
  });
  adapter.registerTool({
    capability: { name: "ci.find_build_by_sha", type: "read" },
    handler: (args) => ({ buildId: "b-100", artifactId: "pkg-999", sha: args.commitSha }),
  });
  adapter.registerTool({
    capability: { name: "registry.get_package_metadata", type: "read" },
    handler: (args) => ({ packageId: args.packageId, version: "1.0.0" }),
  });

  adapter.registerTool({
    capability: { name: "store.get_order", type: "read" },
    handler: (args) => ({ id: args.orderId, status: "fulfilled" }),
  });
  adapter.registerTool({
    capability: { name: "warehouse.get_fulfillment", type: "read" },
    handler: (args) => ({ orderId: args.orderId, trackingNumber: "TRK-5544" }),
  });
  adapter.registerTool({
    capability: { name: "carrier.track_package", type: "read" },
    handler: (args) => ({ trackingNumber: args.trackingNumber, eta: "2026-10-25" }),
  });

  adapter.registerTool({
    capability: { name: "log_store.query_range", type: "read" },
    handler: () => ({ events: [{ path: "/checkout", status: 500 }, { path: "/pay", status: 502 }] }),
  });
  adapter.registerTool({
    capability: { name: "log_analyzer.extract_route_summary", type: "read" },
    handler: (args) => ({ topRoutes: ["/checkout", "/pay"], total: (args.events as unknown[]).length }),
  });

  adapter.registerTool({
    capability: { name: "k8s.describe_all_nodes", type: "read" },
    handler: () => ({ items: [{ id: "node-1", memPct: 88 }, { id: "node-2", memPct: 40 }] }),
  });
  adapter.registerTool({
    capability: { name: "k8s.filter_nodes_above_threshold", type: "read" },
    handler: (args) => ({
      flagged: (args.nodes as Array<{ id: string; memPct: number }>).filter((n) => n.memPct >= Number(args.thresholdPct)),
    }),
  });

  adapter.registerTool({
    capability: { name: "postgres.get_stat_statements", type: "read" },
    handler: () => ({ statements: [{ query: "SELECT * FROM orders", duration: 450 }] }),
  });
  adapter.registerTool({
    capability: { name: "postgres.rank_queries_by_duration", type: "read" },
    handler: (args) => ({ ranked: args.statements }),
  });

  adapter.registerTool({
    capability: { name: "k8s.get_pod_events", type: "read" },
    handler: () => ({ events: ["OOMKilled"] }),
  });
  adapter.registerTool({
    capability: { name: "k8s.get_container_termination_reason", type: "read" },
    handler: (args) => ({ container: args.container, reason: "OOMKilled", exitCode: 137 }),
  });

  adapter.registerTool({
    capability: { name: "k8s.get_cluster_info", type: "read" },
    handler: (args) => ({ cluster: args.cluster, nodes: 12 }),
  });

  adapter.registerTool({
    capability: { name: "ingress.get_routing_table", type: "read" },
    handler: () => ({ backendService: "checkout-svc" }),
  });
  adapter.registerTool({
    capability: { name: "k8s.get_endpoints_for_service", type: "read" },
    handler: () => ({ readyAddresses: ["10.244.1.15"] }),
  });
  adapter.registerTool({
    capability: { name: "network.http_ping_target", type: "read" },
    handler: (args) => ({ targetIp: args.targetIp, reachable: true }),
  });

  adapter.registerTool({
    capability: { name: "k8s.list_tls_secrets", type: "read" },
    handler: () => ({ secretNames: ["prod-wildcard-tls"] }),
  });
  adapter.registerTool({
    capability: { name: "cert_manager.inspect_expiration", type: "read" },
    handler: () => ({ expiringInDays: 45 }),
  });

  adapter.registerTool({
    capability: { name: "mock.read_alpha", type: "read" },
    handler: () => ({ ok: true }),
  });
  adapter.registerTool({
    capability: { name: "mock.read_beta", type: "read" },
    handler: () => ({ ok: true }),
  });
  adapter.registerTool({
    capability: { name: "mock.read_gamma", type: "read" },
    handler: () => ({ ok: true }),
  });
  adapter.registerTool({
    capability: { name: "mock.fast_tool", type: "read" },
    handler: () => ({ ok: true }),
  });
  adapter.registerTool({
    capability: { name: "mock.slow_hanging_tool", type: "read" },
    handler: async (_args, signal) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Timeout aborted"));
        });
      });
      return { ok: true };
    },
  });

  adapter.registerTool({
    capability: { name: "k8s.get_deployment", type: "read" },
    handler: (args) => ({ name: args.name, currentReplicas: 2 }),
  });
  adapter.registerTool({
    capability: { name: "k8s.scale_deployment", type: "write" },
    handler: (args) => ({ name: args.name, updatedReplicas: args.replicas }),
  });
  adapter.registerTool({
    capability: { name: "storage.get_bucket_info", type: "read" },
    handler: (args) => ({ name: args.bucket, bytes: 50000 }),
  });
  adapter.registerTool({
    capability: { name: "storage.purge_bucket", type: "write" },
    handler: () => ({ purged: true }),
  });

  const flags = new Map<string, boolean>();
  adapter.registerTool({
    capability: {
      name: "feature_flag.set_boolean",
      type: "write",
      verificationTool: "feature_flag.get_boolean",
    },
    handler: (args) => {
      flags.set(String(args.flag), Boolean(args.enabled));
      return { flag: String(args.flag), enabled: Boolean(args.enabled) };
    },
  });
  adapter.registerTool({
    capability: { name: "feature_flag.get_boolean", type: "read" },
    handler: (args) => ({ flag: String(args.flag), enabled: flags.get(String(args.flag)) }),
  });

  adapter.registerTool({
    capability: { name: "siem.get_unresolved_alert", type: "read" },
    handler: () => ({ payload: { threatScore: 92, vector: "sql_injection" } }),
  });
  adapter.registerTool({
    capability: { name: "siem.categorize_incident", type: "write" },
    handler: () => ({ categorized: true }),
  });
  adapter.registerTool({
    capability: { name: "ab_testing.get_sample_ratios", type: "read" },
    handler: () => ({ stats: { pValue: 0.048, confidence: 0.95 } }),
  });
  adapter.registerTool({
    capability: { name: "ab_testing.record_decision", type: "write" },
    handler: () => ({ recorded: true }),
  });
  adapter.registerTool({
    capability: { name: "db_migrator.dry_run_ddl", type: "read" },
    handler: () => ({ planSummary: "CREATE INDEX idx_users_email ON users(email);" }),
  });
  adapter.registerTool({
    capability: { name: "db_migrator.apply_live_migration", type: "write" },
    handler: () => ({ applied: true }),
  });

  return adapter;
};

const manifestPath = path.resolve("verify/fixtures/corpus/manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
  categories: Array<{
    id: number;
    name: string;
    tasks: Array<{ id: string; name: string; file: string; expectedStatus: string }>;
  }>;
};

for (const cat of manifest.categories) {
  for (const task of cat.tasks) {
    test(`Corpus ${task.id} (${cat.name}): ${task.name}`, async () => {
      const adapter = setupCorpusAdapter();
      const filePath = path.resolve("verify/fixtures/corpus", task.file);
      const yamlContent = fs.readFileSync(filePath, "utf8");

      const allowWrites =
        (task.expectedStatus === "complete" && cat.name.includes("write")) ||
        cat.name.includes("judgment");
      const interpreter = new Interpreter(adapter, {
        policy: {
          allowWrites,
        },
      });

      if (task.expectedStatus === "validation_error") {
        await assert.rejects(
          () => interpreter.execute(yamlContent),
          (err: unknown) => err instanceof ValidationError
        );
        return;
      }

      if (task.expectedStatus === "pre_execution_rejection") {
        await assert.rejects(
          () => interpreter.execute(yamlContent),
          (err: unknown) =>
            err instanceof PolicyViolationError &&
            err.message.includes("Unknown tool 'non_existent.undefined_tool'")
        );
        return;
      }

      if (task.expectedStatus === "policy_denied") {
        await assert.rejects(
          () => interpreter.execute(yamlContent),
          (err: unknown) => err instanceof PolicyViolationError
        );
        return;
      }

      const { receipt } = await interpreter.execute(yamlContent);

      if (task.expectedStatus === "incomplete") {
        assert.equal(receipt.status, "incomplete");
        assert.equal(receipt.handback?.reason, "requiresJudgment");
      } else if (task.expectedStatus === "failed") {
        assert.equal(receipt.status, "failed");
      } else {
        assert.equal(receipt.status, "complete");
      }
    });
  }
}
