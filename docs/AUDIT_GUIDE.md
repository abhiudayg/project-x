# Project X: Trace Audit & Plan Compilation Guide

**Target Audience:** Agent Developers, Platform Engineers, Infrastructure Optimizers  
**Module:** [`crates/project-x-core/src/audit.rs`](../crates/project-x-core/src/audit.rs)  
**CLI Command:** `project-x audit`  

---

## 1. Overview

Agent workflows frequently waste LLM tokens and add latency by passing deterministic tool outputs back into the model context. 

The **Project X Audit Engine** analyzes raw agent execution traces, calculates the economic and performance overhead of repetitive model round-trips, and automatically compiles the trace into an optimized, type-checked declarative [`ExecutionPlan`](../crates/project-x-core/src/types.rs) (`x.dev/v1alpha1`).

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

The fastest way to audit an agent trace is via the native `project-x` CLI:

```bash
# Analyze trace and print Markdown audit report to stdout
./target/release/project-x audit trace.json

# Analyze trace and export compiled YAML plan + Markdown report to disk
./target/release/project-x audit trace.json --out-plan compiled-plan.yaml --out-report audit-report.md
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

### In Rust
```rust
use project_x_core::audit_trace;
use serde_json::Value;

let trace_val: Value = serde_json::from_str(&trace_str)?;
let report = audit_trace(&trace_val)?;

println!("Savings: {}%", report.savings.token_savings_percentage);
println!("Plan YAML:\n{}", report.plan_yaml);
```

### In Python
```python
import project_x
import json

report_json = project_x.audit_trace(trace_json_str)
report = json.loads(report_json)
print(f"Token savings: {report['savings']['tokenSavingsPercentage']}%")
```

### In Node.js
```javascript
const { auditTrace } = require("./crates/project-x-node");

const report = JSON.parse(auditTrace(traceJsonStr));
console.log(`Token savings: ${report.savings.tokenSavingsPercentage}%`);
```
