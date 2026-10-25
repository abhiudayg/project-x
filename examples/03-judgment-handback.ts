import { InMemoryToolAdapter, ProjectXClient } from "../src/index.js";

const run = async () => {
  const adapter = new InMemoryToolAdapter();

  adapter.registerTool({
    capability: { name: "database.check_replication_lag", type: "read" },
    handler: async () => ({ lagSeconds: 45, thresholdSeconds: 30 }),
  });

  adapter.registerTool({
    capability: { name: "database.run_ddl_migration", type: "write" },
    handler: async (args) => ({ migrated: true, approvedBy: args.approvedBy }),
  });

  const client = new ProjectXClient(adapter);

  const migrationPlanYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: risky-migration-flow
spec:
  steps:
    - id: check-lag
      tool: database.check_replication_lag
      arguments: {}
    - id: apply-migration
      tool: database.run_ddl_migration
      dependsOn:
        - check-lag
      requiresJudgment: true
      arguments:
        migrationId: "20261025_add_index"
  output:
    include:
      - check-lag
      - apply-migration
`;

  console.log("Phase A: Initial Execution until judgment step...");
  const initialResult = await client.executePlan(migrationPlanYaml, {
    policy: { allowWrites: true },
  });

  console.log(`Initial Status: ${initialResult.receipt.status}`);
  console.log(`Lag Result:`, initialResult.outputs["check-lag"]);
  console.log(`Pending Judgment Step: apply-migration`);

  console.log("\nPhase B: Model evaluates high lag and approves with human override...");
  const decision = { approvedBy: "lead-sre-override" };

  const finalResult = await client.resumePlan(
    migrationPlanYaml,
    initialResult.receipt,
    decision,
    { policy: { allowWrites: true } }
  );

  console.log(`Final Resumed Status: ${finalResult.receipt.status}`);
  console.log(`Final Outputs:`, finalResult.outputs["apply-migration"]);
};

run().catch(console.error);
