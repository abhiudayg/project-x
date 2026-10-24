import test from "node:test";
import assert from "node:assert/strict";
import { MultiModelBenchmarkRunner } from "../src/benchmark/runner.js";

test("MultiModelBenchmarkRunner executes 5 trials per task across 2 model families and passes all Decision Gates", async () => {
  const runner = new MultiModelBenchmarkRunner();
  const report = await runner.runBenchmark(5);

  assert.equal(report.overallRecommendation, "PROCEED_TO_PHASE_1");
  assert.equal(report.gateOutcomes.length, 7);

  for (const gate of report.gateOutcomes) {
    assert.equal(
      gate.passed,
      true,
      `Decision Gate '${gate.name}' (${gate.gateId}) must pass. Observed: ${gate.observed}`
    );
  }

  const tokenGate = report.gateOutcomes.find((g) => g.gateId === "GATE-1")!;
  assert.ok(tokenGate.passed);

  const costGate = report.gateOutcomes.find((g) => g.gateId === "GATE-2")!;
  assert.ok(costGate.passed);

  const securityGate = report.gateOutcomes.find((g) => g.gateId === "GATE-4")!;
  assert.ok(securityGate.passed);

  const overheadGate = report.gateOutcomes.find((g) => g.gateId === "GATE-7")!;
  assert.ok(overheadGate.passed);
});
