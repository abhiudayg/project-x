#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { parsePlan } from "../src/parser.js";
import { buildDAG } from "../src/dag.js";
import { Interpreter } from "../src/interpreter.js";
import { InMemoryToolAdapter } from "../src/adapters/in-memory.js";
import { RuntimePolicy } from "../src/policy.js";
import { ExecutionReceipt } from "../src/types.js";
import { MultiModelBenchmarkRunner } from "../src/benchmark/runner.js";
import { auditTrace } from "../src/audit.js";

const printHelp = () => {
  console.log(`
Project X: Declarative Execution Protocol for AI Agents (CLI)

Usage:
  project-x <command> [options]

Commands:
  audit <trace.json>         Audit agent execution trace, calculate token/cost savings, and synthesize ExecutionPlan
  validate <file.yaml>       Validate plan syntax, schema, and DAG dependencies without side-effects
  run <file.yaml>            Execute plan with security policy and emit an execution receipt
  inspect <receipt.json>     Pretty-print an execution receipt and audit verification status
  benchmark [options]        Run multi-model comparative benchmark across 21 tasks and evaluate decision gates

Options for 'audit':
  --out-plan <file.yaml>     Save generated ExecutionPlan YAML to file
  --out-report <file.md>     Save formatted markdown audit report to file

Options for 'run':
  --policy <file.json>       Path to JSON runtime policy file
  --allow-writes             Explicitly grant write permissions to the runtime
  --out <file.json>          Save the execution receipt and outputs to a JSON file
  --dry-run                  Perform pre-execution validation and exit before executing steps
  --help, -h                 Display help information
`);
};

const main = async () => {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  if (command === "audit") {
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: {
        "out-plan": { type: "string" },
        "out-report": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    const filePath = positionals[0];
    if (!filePath) {
      console.error("Error: Missing trace file path for 'audit'");
      process.exit(1);
    }

    try {
      const rawContent = fs.readFileSync(path.resolve(filePath), "utf8");
      const parsed = JSON.parse(rawContent);
      const report = auditTrace(parsed);

      console.log(report.markdownSummary);

      if (values["out-plan"]) {
        fs.writeFileSync(path.resolve(values["out-plan"]), report.planYaml, "utf8");
        console.log(`Plan written to: ${values["out-plan"]}`);
      }

      if (values["out-report"]) {
        fs.writeFileSync(path.resolve(values["out-report"]), report.markdownSummary, "utf8");
        console.log(`Audit report written to: ${values["out-report"]}`);
      }

      process.exit(0);
    } catch (err) {
      console.error(`❌ Audit failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  if (command === "validate") {
    const filePath = args[1];
    if (!filePath) {
      console.error("Error: Missing file path for 'validate'");
      process.exit(1);
    }

    try {
      const content = fs.readFileSync(path.resolve(filePath), "utf8");
      const { plan, digest } = parsePlan(content);
      const dag = buildDAG(plan);

      console.log(`✅ Plan is valid: ${plan.metadata.name}`);
      console.log(`   API Version: ${plan.apiVersion}`);
      console.log(`   Digest:      ${digest}`);
      console.log(`   Steps:       ${plan.spec.steps.length} (${dag.executionWaves.length} execution wave[s])`);
      console.log(`   Topological: ${dag.topologicalOrder.join(" -> ")}`);
      process.exit(0);
    } catch (err) {
      console.error(`❌ Validation failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  if (command === "run") {
    const { values, positionals } = parseArgs({
      args: args.slice(1),
      options: {
        policy: { type: "string" },
        "allow-writes": { type: "boolean", default: false },
        out: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    const filePath = positionals[0];
    if (!filePath || values.help) {
      printHelp();
      process.exit(filePath ? 0 : 1);
    }

    try {
      const content = fs.readFileSync(path.resolve(filePath), "utf8");
      const { plan, digest } = parsePlan(content);
      const dag = buildDAG(plan);

      if (values["dry-run"]) {
        console.log(`✅ Dry-run passed: Plan '${plan.metadata.name}' validated successfully.`);
        console.log(`   Digest: ${digest}`);
        process.exit(0);
      }

      let runtimePolicy: RuntimePolicy = {
        allowWrites: values["allow-writes"] ?? false,
      };

      if (values.policy) {
        const policyContent = fs.readFileSync(path.resolve(values.policy), "utf8");
        const parsed = JSON.parse(policyContent);
        runtimePolicy = {
          ...parsed,
          allowWrites: values["allow-writes"] || parsed.allowWrites,
        };
      }

      const adapter = new InMemoryToolAdapter();
      for (const step of plan.spec.steps) {
        adapter.registerTool({
          capability: { name: step.tool, type: "read" },
          handler: (a) => ({ ...a, executed: true, tool: step.tool }),
        });
      }

      const interpreter = new Interpreter(adapter, { policy: runtimePolicy });
      const { receipt, outputs } = await interpreter.execute(plan);

      console.log(`\n=== Execution Receipt ===`);
      console.log(`Plan:     ${receipt.planId} (${receipt.schemaVersion})`);
      console.log(`Digest:   ${receipt.planDigest}`);
      console.log(`Status:   ${receipt.status.toUpperCase()}`);
      console.log(`Duration: ${receipt.timestamps.durationMs}ms`);
      console.log(`Outputs:  ${JSON.stringify(outputs, null, 2)}`);

      if (values.out) {
        fs.writeFileSync(
          path.resolve(values.out),
          JSON.stringify({ receipt, outputs }, null, 2),
          "utf8"
        );
        console.log(`\nReceipt saved to: ${values.out}`);
      }

      process.exit(receipt.status === "failed" ? 1 : 0);
    } catch (err) {
      console.error(`❌ Execution failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  if (command === "inspect") {
    const filePath = args[1];
    if (!filePath) {
      console.error("Error: Missing file path for 'inspect'");
      process.exit(1);
    }

    try {
      const content = fs.readFileSync(path.resolve(filePath), "utf8");
      const parsed = JSON.parse(content);
      const receipt: ExecutionReceipt = parsed.receipt ?? parsed;

      console.log(`\n=== Inspecting Receipt: ${receipt.planId} ===`);
      console.log(`Execution ID: ${receipt.executionId}`);
      console.log(`Digest:       ${receipt.planDigest}`);
      console.log(`Status:       ${receipt.status}`);
      console.log(`Duration:     ${receipt.timestamps.durationMs}ms`);
      console.log(`Overhead:     ${receipt.metrics.interpreterOverheadMs}ms`);
      console.log(`Total Bytes:  ${receipt.metrics.totalBytesProcessed} bytes`);
      console.log(`\nSteps Execution Summary:`);
      for (const [id, rec] of Object.entries(receipt.steps)) {
        console.log(` - Step '${id}': ${rec.status} (${rec.durationMs}ms, verified=${rec.verification})`);
      }
      process.exit(0);
    } catch (err) {
      console.error(`❌ Failed to inspect receipt: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  if (command === "benchmark") {
    try {
      const { values } = parseArgs({
        args: args.slice(1),
        options: {
          trials: { type: "string", default: "5" },
          out: { type: "string" },
        },
      });

      const trialsCount = parseInt(values.trials ?? "5", 10);
      console.log(`\n=== Running Multi-Model Benchmark (${trialsCount} trials/task) ===`);
      const runner = new MultiModelBenchmarkRunner();
      const report = await runner.runBenchmark(trialsCount);

      console.log(`Report generated at: ${report.generatedAt}`);
      console.log(`\nDecision Gates Evaluation Summary:`);
      for (const gate of report.gateOutcomes) {
        const mark = gate.passed ? "✅ PASS" : "❌ FAIL";
        console.log(` [${mark}] ${gate.gateId}: ${gate.name}`);
        console.log(`        Target:   ${gate.target}`);
        console.log(`        Observed: ${gate.observed}`);
        console.log(`        Details:  ${gate.rationale}`);
      }
      console.log(`\nOverall Recommendation: ${report.overallRecommendation}`);

      if (values.out) {
        fs.writeFileSync(
          path.resolve(values.out),
          JSON.stringify(report, null, 2),
          "utf8"
        );
        console.log(`\nBenchmark report saved to: ${values.out}`);
      }

      const allPassed = report.gateOutcomes.every((g) => g.passed);
      process.exit(allPassed ? 0 : 1);
    } catch (err) {
      console.error(`❌ Benchmark execution failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  console.error(`Unknown command: '${command}'`);
  printHelp();
  process.exit(1);
};

main();
