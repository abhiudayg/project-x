# Project X: Developer Integration Guide & Reference

**Target Audience:** Agent Engineers, Tool Authors, Infrastructure Developers  
**License:** Apache-2.0  
**Core Engine:** Rust Workspace (`crates/project-x-core`)  

---

## 1. Quickstart (5 Minutes)

Project X executes bounded, deterministic multi-tool workflows above your existing tools without repetitive model round-trips.

### Installation

```bash
# Build the workspace and generate release binaries and dynamic libraries
cargo build --release --workspace

# The native CLI binary is produced at:
./target/release/project-x
```

---

## 2. Using the Native CLI (`project-x`)

### Validate Plan
Validates syntax, schema, permissions, and DAG cycles without any side effects:
```bash
./target/release/project-x validate verify/fixtures/valid-multi-step.yaml
```

### Dry Run with Policy Enforcement
Tests whether the runtime policy permits the plan's operations before executing:
```bash
./target/release/project-x run verify/fixtures/valid-multi-step.yaml --dry-run
```

### Audit an Agent Trace
Analyzes an agent trace (OpenAI, LangChain, or raw turn JSON), computes token/latency savings, and synthesizes a compiled YAML plan:
```bash
./target/release/project-x audit trace.json --out-plan plan.yaml --out-report audit-report.md
```

### Inspect an Execution Receipt
Pretty-prints execution timing, step statuses, SHA-256 argument hashes, and verification outcomes:
```bash
./target/release/project-x inspect receipt.json
```

---

## 3. Integration in Rust (`crates/project-x-core`)

Add to your `Cargo.toml`:
```toml
[dependencies]
project-x-core = { path = "path/to/crates/project-x-core" }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
```

### Rust Example

```rust
use project_x_core::{
    parse_plan, ExecutionOptions, InMemoryToolAdapter, Interpreter, RuntimePolicy,
};
use serde_json::json;
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Wrap tools in the adapter
    let mut adapter = InMemoryToolAdapter::new();
    adapter.register_tool("geo.lookup", |_args| {
        Ok(json!({ "city": "Seattle" }))
    });
    adapter.register_tool("weather.forecast", |args| {
        let city = args.get("city").and_then(|v| v.as_str()).unwrap_or("Unknown");
        Ok(json!({ "city": city, "tempF": 62 }))
    });

    // 2. Define the declarative execution plan
    let plan_yaml = r#"
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: weather-pipeline
spec:
  permissions:
    - tools:geo.lookup:read
    - tools:weather.forecast:read
  steps:
    - id: lookup
      tool: geo.lookup
      arguments: {}
    - id: forecast
      tool: weather.forecast
      dependsOn: [lookup]
      arguments:
        city:
          from: lookup
          path: city
  output:
    include: [forecast]
"#;

    // 3. Configure execution policy & timeout
    let options = ExecutionOptions {
        policy: RuntimePolicy {
            allow_writes: false,
            granted_permissions: vec![
                "tools:geo.lookup:read".to_string(),
                "tools:weather.forecast:read".to_string(),
            ],
        },
        default_timeout_ms: 5000,
    };

    // 4. Execute with sub-millisecond overhead
    let interpreter = Interpreter::new(Arc::new(adapter), options);
    let result = interpreter.execute(plan_yaml).await?;

    println!("Status: {:?}", result.receipt.status);
    println!("Execution ID: {}", result.receipt.execution_id);
    println!("Outputs: {:?}", result.outputs.get("forecast"));

    Ok(())
}
```

---

## 4. Integration in Python (`crates/project-x-py`)

Prebuilt via PyO3 and Maturin:

```bash
# In crates/project-x-py/
maturin develop
```

```python
import project_x

# 1. Pre-execution plan validation
validation = project_x.validate_plan(plan_yaml)
print(f"Plan: {validation.name}, Waves: {validation.waves_count}")
print(f"Topological Order: {validation.topological_order}")

# 2. Compute canonical SHA-256 digest
digest = project_x.compute_digest(plan_yaml)
print(f"Digest: {digest}")

# 3. Ingest agent trace and generate audit
report_json = project_x.audit_trace(open_ai_trace_json_str)
```

---

## 5. Integration in Node.js (`crates/project-x-node`)

Prebuilt via NAPI-RS:

```javascript
const { validatePlan, computeDigest, auditTrace } = require("./crates/project-x-node");

// 1. Validate plan
const validation = validatePlan(planYaml);
console.log(`Plan: ${validation.name}, Digest: ${validation.digest}`);

// 2. Audit trace
const report = JSON.parse(auditTrace(traceJson));
console.log(`Token Savings: ${report.savings.tokenSavingsPercentage}%`);
```

---

## 6. Verification & Test Suite

The verification harness validates workspace compilation, hygiene, formatting, integration tests, and fixture immutability:

```bash
sh .verify/run.sh all
```
