# Project X: Trace Audit & Plan Compilation Guide

**Target Audience:** Agent Developers, Platform Engineers, Infrastructure Optimizers  
**Module:** [`src/audit.ts`](../src/audit.ts)  
**CLI Command:** `project-x audit`  

---

## 1. Overview

Agent workflows frequently waste LLM tokens and add latency by passing deterministic tool outputs back into the model context. 

The **Project X Audit Engine** analyzes raw agent execution traces, calculates the economic and performance overhead of repetitive model round-trips, and automatically compiles the trace into an optimized, type-checked declarative [`ExecutionPlan`](../src/types.ts) (`x.dev/v1alpha1`).

---

## 2. Supported Trace Formats

The audit engine automatically detects and normalizes three primary trace formats:

### Format A: OpenAI / Chat Completion Message History
Exports from standard OpenAI, Anthropic, or OpenAI-compatible tool-calling loops:
```json
{
  "messages": [
    { "role": "user", "content": "Triage billing failure" },
    {
      "role": "assistant",
      "tool_calls": [
        {
          "id": "call_1",
          "type": "function",
          "function": {
            "name": "list_invoices",
            "arguments": "{\"status\":\"failed\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_1",
      "content": "{\"failedInvoiceId\":\"inv_992\",\"amount\":450}"
    },
    {
      "role": "assistant",
      "tool_calls": [
        {
          "id": "call_2",
          "type": "function",
          "function": {
            "name": "retry_charge",
            "arguments": "{\"invoiceId\":\"inv_992\"}"
          }
        }
      ]
    },
    {
      "role": "tool",
      "tool_call_id": "call_2",
      "content": "{\"success\":true}"
    }
  ]
}
```

### Format B: Standard Project X Turn Array
```json
{
  "name": "billing-triage",
  "turns": [
    {
      "id": "fetch_invoices",
      "tool": "list_invoices",
      "arguments": { "status": "failed" },
      "output": { "failedInvoiceId": "inv_992" }
    },
    {
      "id": "charge",
      "tool": "retry_charge",
      "arguments": { "invoiceId": "inv_992" },
      "output": { "success": true }
    }
  ]
}
```

### Format C: Raw Turn Array
```json
[
  { "tool": "list_invoices", "arguments": { "status": "failed" }, "output": { "failedInvoiceId": "inv_992" } },
  { "tool": "retry_charge", "arguments": { "invoiceId": "inv_992" }, "output": { "success": true } }
]
```

---

## 3. CLI Usage

The fastest way to audit an agent trace is via the `project-x` CLI:

```bash
# Analyze trace and print Markdown audit report to stdout
project-x audit trace.json

# Analyze trace and export compiled YAML plan + Markdown report to disk
project-x audit trace.json --out-plan compiled-plan.yaml --out-report audit-report.md
```

### Sample CLI Output
```markdown
# Project X Agent Audit Report
**Trace Name:** billing-triage
**Generated At:** 2026-10-25T17:30:00.000Z

## 1. Economic & Latency Optimization
| Metric | Baseline (Native Agent) | Project X Execution | Savings |
| :--- | :--- | :--- | :--- |
| **Model Round Trips** | 3 | 1 | **2 (67%)** |
| **Estimated Context Tokens** | 4,250 | 1,650 | **2,600 (61.2%)** |
| **Estimated LLM Cost** | $0.0210 | $0.0075 | **$0.0135** |
| **Estimated Latency Saved** | Baseline | -2.8s | **~2800ms** |

## 2. Security & Boundary Analysis
- **Read Tools Identified (1):** list_invoices
- **Write / Side-Effect Tools (1):** retry_charge
- **Automated Deterministic Steps:** 2
- **Steps Yielding to Model (Judgment):** 0
- **Enforced Permissions:** `tools:list_invoices:read`, `tools:retry_charge:write`

## 3. Compiled Declarative Plan
...
```

---

## 4. Programmatic API

You can call the audit engine directly in your Node.js or TypeScript code:

```typescript
import { auditTrace } from "project-x";

const rawTrace = JSON.parse(fs.readFileSync("trace.json", "utf8"));
const report = auditTrace(rawTrace);

console.log("Token Savings:", report.savings.tokenSavingsPercentage, "%");
console.log("Cost Savings:", report.savings.costSavingsUsd);
console.log("Plan YAML:\n", report.planYaml);
```

---

## 5. MCP Gateway Integration

When running the [`MCPGatewayProxy`](../src/proxy/mcp-gateway.ts) with `{ enableAuditTool: true }`, external models or agents can invoke the audit tool over JSON-RPC:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "x_audit_trace",
    "arguments": {
      "trace": { ... }
    }
  }
}
```
