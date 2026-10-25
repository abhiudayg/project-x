# Project X: Declarative Execution Protocol for AI Agents

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Verification: agstack](https://img.shields.io/badge/Verification-agstack%20passing-brightgreen)](.verify/run.sh)
[![Tests: 25 passing](https://img.shields.io/badge/Tests-25%20passing-brightgreen)](#testing--verification)

> **X** is an embedded declarative execution runtime and protocol layer for AI agents. It executes bounded, deterministic multi-tool workflows above existing tool infrastructure (e.g. MCP, HTTP APIs, and local SDKs), returning compact, verifiable execution receipts without unnecessary model round trips.

---

## 1. Executive Summary

AI agents frequently invoke tools through protocols like MCP (Model Context Protocol). Multi-step tasks conventionally require repetitive model round trips, oversized tool definitions in context, and intermediate outputs sent back to the model even when intermediate steps require zero additional reasoning.

**Project X** introduces a bounded, declarative execution contract:
- The agent emits a static, typed `ExecutionPlan` (YAML or JSON).
- The embedded X runtime validates schemas, detects DAG cycles, and verifies tool permissions **before any side effect occurs**.
- Independent steps execute in concurrent waves; intermediate results stay inside the runtime boundary unless requested.
- Steps requiring reasoning can yield control back to the model via `requiresJudgment`.
- The runtime returns a structured, queryable **Execution Receipt** with SHA-256 argument hashes and explicit verification status.

---

## 2. Architecture & Lifecycle

```text
Agent / Model
     |
     | ExecutionPlan (YAML/JSON)
     v
+--------------------------------------------------------+
|                   Project X Runtime                    |
|                                                        |
|  1. Parser & Schema Validator (no side effects)        |
|  2. DAG Builder & Cycle Detection (Kahn's Algorithm)   |
|  3. Pre-Execution Policy & Capability Gating           |
|  4. Topological Wave Scheduler & Reference Resolver    |
|  5. Tool Boundary Policy Enforcement                   |
|  6. Postcondition Verifier (read-back equality/hash)   |
|  7. Receipt Builder & Sanitization                     |
+--------------------------------------------------------+
     |                    |                    |
     v                    v                    v
MCP Adapter          HTTP Adapter         SDK Adapter
(Model Context Proto)   (REST / gRPC)       (In-Memory / Native)
     |                    |                    |
     +--------------------+--------------------+
                          |
                          v
               Execution Receipt & Output
                          |
                          v
                    Agent / Model
```

---

## 3. Plan Specification (`x.dev/v1alpha1`)

```yaml
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan

metadata:
  name: investigate-deployment

spec:
  limits:
    maxSteps: 5
    timeoutMs: 15000
    maxResultBytes: 12000

  permissions:
    - deployments.read
    - logs.read

  steps:
    - id: deployment
      tool: kubernetes.get_deployment
      arguments:
        namespace: production
        name: payments-api

    - id: logs
      tool: kubernetes.get_logs
      dependsOn:
        - deployment
      arguments:
        namespace: production
        deployment:
          from: deployment
          path: name
        tailLines: 100

  output:
    include:
      - deployment
      - logs
```

---

## 4. Architectural Guarantees & Differentiation (PRD §10.3)

Project X is benchmarked against **Baseline A (Native MCP)** and **Baseline B (Hardened Code Mode)**. Detailed methodology, test apparatus, and comparative reports are documented in [docs/BENCHMARKS.md](docs/BENCHMARKS.md):

| Guarantee | Test | Expected Result | Verified |
|---|---|---|:---:|
| **Pre-Execution Validation** | Submit a plan with a schema/tool error in step 4 of 5 | X rejects before any side effect. Code Mode executes steps 1–3 first. | ✅ |
| **Tool-Boundary Policy** | Attempt out-of-scope write via permitted tool | Blocked at adapter boundary with explicit audit record. | ✅ |
| **Write Gating Without Execution** | Plan contains write operation without grant | X rejects at validation. Zero steps execute (including read steps). | ✅ |
| **Structured, Queryable Record** | Answer audit questions from receipt alone | Answered via machine-readable receipt without parsing code. | ✅ |
| **Bounded Side Effects on Failure** | Inject timeout or crash mid-workflow | Downstream steps marked `skipped`; partial side effects isolated. | ✅ |

---

## 5. Getting Started

### Installation

```bash
# Build all workspace crates (CLI, core library, Python bindings, Node bindings)
cargo build --release --workspace

# The native CLI binary is produced at:
# ./target/release/project-x
```

### CLI Usage (`project-x`)

Project X includes a zero-overhead native Rust CLI:

```bash
# 1. Audit an existing agent trace (OpenAI, LangChain, or raw JSON), calculate token/cost savings, and compile an ExecutionPlan
./target/release/project-x audit trace.json --out-plan plan.yaml --out-report audit-report.md

# 2. Validate plan syntax, schema, and DAG dependencies without executing side-effects
./target/release/project-x validate verify/fixtures/valid-multi-step.yaml

# 3. Perform a pre-execution dry run check
./target/release/project-x run verify/fixtures/valid-multi-step.yaml --dry-run

# 4. Execute plan with policy and output receipt
./target/release/project-x run verify/fixtures/valid-multi-step.yaml --out receipt.json

# 5. Inspect and pretty-print an execution receipt
./target/release/project-x inspect receipt.json
```

---

### Polyglot Language Bindings

#### Python (`crates/project-x-py`)
Prebuilt via PyO3 / Maturin:
```python
import project_x

# Validate plan and inspect DAG execution waves
validation = project_x.validate_plan(plan_yaml)
print(f"Valid: {validation.valid}, Waves: {validation.waves_count}")

# Audit agent trace and synthesize ExecutionPlan
report = project_x.audit_trace(trace_json_str)
```

#### Node.js (`crates/project-x-node`)
Prebuilt via NAPI-RS:
```javascript
const { validatePlan, auditTrace } = require("./crates/project-x-node");

const validation = validatePlan(planYaml);
console.log(`Plan: ${validation.name}, Digest: ${validation.digest}`);
```

---

### Programmatic Rust Library Usage (`crates/project-x-core`)

```rust
use project_x_core::{parse_plan, build_dag, Interpreter, InMemoryToolAdapter, ExecutionOptions, RuntimePolicy};
use std::sync::Arc;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut adapter = InMemoryToolAdapter::new();
    adapter.register_tool("telemetry.get_cluster_cpu", |_args| {
        Ok(json!({ "cpu": 42.5 }))
    });

    let options = ExecutionOptions {
        policy: RuntimePolicy { allow_writes: false, granted_permissions: vec![] },
        default_timeout_ms: 10000,
    };

    let interpreter = Interpreter::new(Arc::new(adapter), options);
    let result = interpreter.execute(plan_yaml).await?;

    println!("Status: {:?}", result.receipt.status);
    println!("Execution ID: {}", result.receipt.execution_id);
    Ok(())
}
```

---

## 6. Testing & Verification

Project X adheres to the universal `agstack` engineering policy. All verification runs output strictly to `.verify/` keeping reference fixtures in `verify/` read-only.

```bash
# Run complete test and lint suite via agstack harness
bash .verify/run.sh
```

---

## 7. Documentation Guides

- [Developer Guide & SDK Reference](docs/DEVELOPER_GUIDE.md)
- [Trace Audit & Plan Compilation Guide](docs/AUDIT_GUIDE.md)
- [Empirical Benchmarks & Differentiation](docs/BENCHMARKS.md)
- [Phase 2 Multi-Model Evaluation](docs/PHASE_2_EVALUATION.md)

---

## 8. License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
