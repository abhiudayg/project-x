import { InMemoryToolAdapter, ProjectXClient } from "../src/index.js";

const run = async () => {
  const adapter = new InMemoryToolAdapter();

  adapter.registerTool({
    capability: { name: "metrics.cpu", type: "read" },
    handler: async (args) => ({ cluster: args.cluster, usagePercent: 42.5 }),
  });

  adapter.registerTool({
    capability: { name: "metrics.memory", type: "read" },
    handler: async (args) => ({ cluster: args.cluster, usedGigabytes: 18.2 }),
  });

  adapter.registerTool({
    capability: { name: "reporter.summarize", type: "read" },
    handler: async (args) => ({
      report: `Cluster ${args.cluster} is healthy (CPU: ${args.cpu}%, Mem: ${args.memory}GB)`,
    }),
  });

  const client = new ProjectXClient(adapter);

  const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: cluster-health-check
spec:
  limits:
    maxSteps: 5
    timeoutMs: 5000
    maxResultBytes: 10000
  steps:
    - id: fetch-cpu
      tool: metrics.cpu
      arguments:
        cluster: "us-east-prod"
    - id: fetch-mem
      tool: metrics.memory
      arguments:
        cluster: "us-east-prod"
    - id: build-summary
      tool: reporter.summarize
      dependsOn:
        - fetch-cpu
        - fetch-mem
      arguments:
        cluster: "us-east-prod"
        cpu: $steps.fetch-cpu.output.usagePercent
        memory: $steps.fetch-mem.output.usedGigabytes
  output:
    include:
      - build-summary
`;

  const validation = client.validatePlan(planYaml);
  console.log(`Plan Valid: ${validation.valid}`);
  console.log(`Execution Waves: ${validation.dag.executionWaves.length}`);

  const { receipt, outputs } = await client.executePlan(planYaml);
  console.log(`Status: ${receipt.status}`);
  console.log(`Receipt Duration: ${receipt.timestamps.durationMs}ms`);
  console.log(`Summary Output:`, outputs["build-summary"]);
};

run().catch(console.error);
