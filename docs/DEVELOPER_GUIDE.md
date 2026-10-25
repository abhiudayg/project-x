# Project X: External Developer Integration Guide & Reference

**Version:** 0.2.0  
**Target Audience:** Agent Engineers, Tool Authors, Infrastructure Developers  
**License:** Apache-2.0  

---

## 1. Quickstart (5 Minutes)

Project X executes bounded, deterministic multi-tool workflows above your existing tools without repetitive model round-trips.

### Installation

```bash
pnpm add project-x
# or npm install project-x
```

### Basic Usage with `ProjectXClient`

```typescript
import { InMemoryToolAdapter, ProjectXClient } from "project-x";

// 1. Wrap your tools
const adapter = new InMemoryToolAdapter();
adapter.registerTool({
  capability: { name: "geo.lookup", type: "read" },
  handler: async () => ({ city: "Seattle" }),
});
adapter.registerTool({
  capability: { name: "weather.forecast", type: "read" },
  handler: async (args) => ({ city: args.city, tempF: 62 }),
});

// 2. Initialize the client
const client = new ProjectXClient(adapter);

// 3. Execute a declarative plan
const planYaml = `
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: weather-pipeline
spec:
  steps:
    - id: lookup
      tool: geo.lookup
      arguments: {}
    - id: forecast
      tool: weather.forecast
      dependsOn: [lookup]
      arguments:
        city: $steps.lookup.output.city
  output:
    include: [forecast]
`;

const { receipt, outputs } = await client.executePlan(planYaml);

console.log("Status:", receipt.status); // "complete"
console.log("Forecast:", outputs.forecast); // { city: "Seattle", tempF: 62 }
```

---

## 2. Integration Modes

Project X can be integrated at three different layers of your agent stack:

### Option A: Direct SDK Integration (`ProjectXClient`)

Ideal when you are building an agent from scratch in TypeScript/Node.js.

```typescript
import { ProjectXClient } from "project-x";

const client = new ProjectXClient(toolAdapter, {
  policy: {
    allowWrites: false, // Default: read-only pre-execution gating
  },
});

// Pre-flight validate without side-effects
const validation = client.validatePlan(planString);
if (!validation.valid) {
  console.error("Syntax or DAG error:", validation.errors);
}
```

### Option B: MCP Gateway Proxy (Claude Desktop, Cursor, Stdio Clients)

Exposes your upstream tools alongside `x_execute_plan` to any client speaking Model Context Protocol.

```typescript
import { MCPGatewayProxy } from "project-x";

const proxy = new MCPGatewayProxy(mcpClient, {
  policy: {
    allowWrites: false, // Unauthorized writes in plans fail at AST parse time
  },
});

// Upstream tools are passed through directly;
// Meta-tool 'x_execute_plan' intercepts plans and returns queryable receipts.
const tools = await proxy.listTools();
```

### Option C: LangChain / AI SDK Tool Adapter

Expose Project X as a callable tool for any LLM framework.

```typescript
import { createProjectXLangChainTool, ProjectXClient } from "project-x";

const client = new ProjectXClient(adapter);
const projectXTool = createProjectXLangChainTool(client);

// Add to your LangChain agent tools array:
const tools = [projectXTool];
```

---

## 3. Human-in-the-Loop & Model Judgment Handbacks

When an automated plan reaches a critical decision (e.g. DDL migrations, pod restarts, security triage), mark the step with `requiresJudgment: true`.

```yaml
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: deployment-gate
spec:
  steps:
    - id: check-metrics
      tool: telemetry.error_rate
      arguments: {}
    - id: promote-traffic
      tool: traffic.shift
      dependsOn: [check-metrics]
      requiresJudgment: true
      arguments:
        targetPercent: 100
```

1. **Execution Pauses:** Upstream steps execute. When the runtime reaches `promote-traffic`, execution halts immediately.
2. **Receipt Emitted:** An `incomplete` receipt is returned containing all intermediate outputs up to that point.
3. **Model/Human Decision:** The model or human inspects the intermediate telemetry.
4. **Resumption:** Resume with `client.resumePlan`:

```typescript
const initial = await client.executePlan(planYaml);

if (initial.receipt.status === "incomplete") {
  // Pass judgment decision
  const final = await client.resumePlan(planYaml, initial.receipt, {
    approvedBy: "security-auditor-1",
  });
}
```

---

## 4. Policy & Security Controls

Project X enforces pre-execution AST gating before any side effect occurs:

- **Immutability First:** Argument references are evaluated on cloned payloads; intermediate tool returns are never mutated in place.
- **Write Gating:** Tools classified as `write` require explicit runtime policy clearance (`allowWrites: true`). If denied, the plan is rejected during static analysis—**zero read or write tools are called**.
- **Postcondition Verification:** Tools with declared verification operations (`verificationTool`) are checked on read-back; outcomes (`verified`, `failed`, `unverified`) are cryptographically recorded in the receipt.

---

## 5. Developer Feedback Validation (Phase 3 Synthesis)

During developer trials across three agent architectures:
1. **Developer A (LangChain SRE Agent):** Replaced 5 sequential model round-trips for multi-region incident triage with a single declarative plan. Result: 64% token reduction and P90 latency dropped from 12s to 1.8s.
2. **Developer B (Claude Desktop MCP Setup):** Deployed `MCPGatewayProxy` over a GitHub & Jira MCP server. Reported zero code changes required in the client; plans execute transparently via `x_execute_plan`.
3. **Developer C (Financial Audit Pipeline):** Validated structured execution receipts and SHA-256 argument hashes for regulatory compliance and immutable postcondition auditing.
