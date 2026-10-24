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
pnpm install
pnpm run build
```

### CLI Usage (`project-x`)

Project X includes a zero-dependency CLI for terminal automation, CI/CD gates, and developer debugging:

```bash
# 1. Validate plan syntax, schema, and DAG dependencies without executing side-effects
node dist/bin/project-x.js validate verify/fixtures/valid-multi-step.yaml

# 2. Perform a pre-execution dry run check
node dist/bin/project-x.js run verify/fixtures/valid-multi-step.yaml --dry-run

# 3. Execute plan with policy and output receipt
node dist/bin/project-x.js run verify/fixtures/valid-multi-step.yaml --out receipt.json

# 4. Inspect and pretty-print an execution receipt
node dist/bin/project-x.js inspect receipt.json
```

### Transparent MCP Gateway Proxy

Project X can inject transparently between any AI Agent and upstream MCP servers:

```typescript
import { MCPGatewayProxy, InMemoryToolAdapter } from "project-x";

const upstream = new InMemoryToolAdapter();
// Register upstream tools (Kubernetes, Postgres, etc.)

// Wrap upstream adapter with Project X Gateway
const gateway = new MCPGatewayProxy(upstream, {
  policy: { allowWrites: false },
});

// Exposes all upstream tools PLUS 'x_execute_plan' meta-tool
const tools = await gateway.listTools();

// Handle standard MCP JSON-RPC requests
const rpcResponse = await gateway.handleJsonRpc({
  id: 1,
  method: "tools/call",
  params: {
    name: "x_execute_plan",
    arguments: { plan: planYaml },
  },
});
```

### Programmatic Library Usage

```typescript
import { Interpreter, parsePlan, InMemoryToolAdapter } from "project-x";

// 1. Initialize tool adapter
const adapter = new InMemoryToolAdapter();
adapter.registerTool({
  capability: { name: "kubernetes.get_deployment", type: "read" },
  handler: (args) => ({ name: args.name, status: "Running" }),
});

// 2. Initialize runtime with policy
const interpreter = new Interpreter(adapter, {
  policy: {
    allowedTools: new Set(["kubernetes.get_deployment"]),
    allowWrites: false,
  },
});

// 3. Execute plan
const planYaml = `...`;
const { receipt, outputs } = await interpreter.execute(planYaml);

console.log("Status:", receipt.status);
console.log("Digest:", receipt.planDigest);
console.log("Outputs:", outputs);
```

---

## 6. Testing & Verification

Project X adheres to the universal `agstack` engineering policy. All verification runs output strictly to `.verify/` keeping reference fixtures in `verify/` read-only.

```bash
# Run unit and differentiation suites via agstack harness
pnpm run verify
# or
bash .verify/run.sh
```

---

## 7. License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
