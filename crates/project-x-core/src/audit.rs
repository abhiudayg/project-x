use crate::types::{ExecutionPlan, PlanLimits, PlanMetadata, PlanOutputSpec, PlanSpec, PlanStep};
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AuditError {
    #[error("Failed to parse trace: {0}")]
    ParseError(String),
    #[error("Trace contains no tool turns")]
    EmptyTrace,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceTurn {
    #[serde(default)]
    pub id: Option<String>,
    pub tool: String,
    #[serde(default)]
    pub arguments: Map<String, Value>,
    #[serde(default)]
    pub output: Option<Value>,
    #[serde(default, rename = "requiresJudgment")]
    pub requires_judgment: bool,
    #[serde(default)]
    pub tokens: Option<TokenUsage>,
    #[serde(default, rename = "durationMs")]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenUsage {
    pub input: Option<usize>,
    pub output: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentTrace {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub turns: Vec<TraceTurn>,
    #[serde(default = "default_cost_input", rename = "modelCostPerMillionInput")]
    pub model_cost_per_million_input: f64,
    #[serde(default = "default_cost_output", rename = "modelCostPerMillionOutput")]
    pub model_cost_per_million_output: f64,
}

fn default_cost_input() -> f64 {
    3.0
}
fn default_cost_output() -> f64 {
    15.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditSavings {
    #[serde(rename = "baselineRoundTrips")]
    pub baseline_round_trips: usize,
    #[serde(rename = "projectXRoundTrips")]
    pub project_x_round_trips: usize,
    #[serde(rename = "roundTripsSaved")]
    pub round_trips_saved: usize,
    #[serde(rename = "baselineTokens")]
    pub baseline_tokens: usize,
    #[serde(rename = "projectXTokens")]
    pub project_x_tokens: usize,
    #[serde(rename = "tokensSaved")]
    pub tokens_saved: usize,
    #[serde(rename = "tokenSavingsPercentage")]
    pub token_savings_percentage: f64,
    #[serde(rename = "estimatedBaselineCostUsd")]
    pub estimated_baseline_cost_usd: f64,
    #[serde(rename = "estimatedProjectXCostUsd")]
    pub estimated_project_x_cost_usd: f64,
    #[serde(rename = "costSavingsUsd")]
    pub cost_savings_usd: f64,
    #[serde(rename = "estimatedLatencyReductionMs")]
    pub estimated_latency_reduction_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityAuditResult {
    #[serde(rename = "readTools")]
    pub read_tools: Vec<String>,
    #[serde(rename = "writeTools")]
    pub write_tools: Vec<String>,
    #[serde(rename = "permissionsRequired")]
    pub permissions_required: Vec<String>,
    #[serde(rename = "judgmentStepsCount")]
    pub judgment_steps_count: usize,
    #[serde(rename = "automatedStepsCount")]
    pub automated_steps_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditReport {
    #[serde(rename = "traceName")]
    pub trace_name: String,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
    #[serde(rename = "generatedPlan")]
    pub generated_plan: ExecutionPlan,
    #[serde(rename = "planYaml")]
    pub plan_yaml: String,
    pub savings: AuditSavings,
    pub security: SecurityAuditResult,
    #[serde(rename = "markdownSummary")]
    pub markdown_summary: String,
}

fn is_write_tool(tool_name: &str) -> bool {
    let read_prefix = Regex::new(
        r"(^|[_|\.])(get|list|fetch|read|describe|scan|check|query|find|inspect|search)(_|\.|$)",
    )
    .unwrap();
    let write_verb = Regex::new(
        r"(^|[_|\.])(create|delete|remove|write|update|patch|post|deploy|restart|kill|set|apply)(_|\.|$)",
    )
    .unwrap();

    if read_prefix.is_match(tool_name) {
        return false;
    }
    write_verb.is_match(tool_name)
}

fn find_matching_path(value: &Value, output: &Value, current_path: &str) -> Option<String> {
    if value.is_null() || value.as_str() == Some("") {
        return None;
    }

    match output {
        Value::Object(map) => {
            for (k, v) in map {
                let prop_path = if current_path.is_empty() {
                    k.clone()
                } else {
                    format!("{current_path}.{k}")
                };
                if v == value {
                    return Some(prop_path);
                }
                if v.is_object() || v.is_array() {
                    if let Some(nested) = find_matching_path(value, v, &prop_path) {
                        return Some(nested);
                    }
                }
            }
            None
        }
        Value::Array(arr) => {
            for (i, v) in arr.iter().enumerate() {
                let arr_path = if current_path.is_empty() {
                    format!("[{i}]")
                } else {
                    format!("{current_path}[{i}]")
                };
                if v == value {
                    return Some(arr_path);
                }
                if v.is_object() || v.is_array() {
                    if let Some(nested) = find_matching_path(value, v, &arr_path) {
                        return Some(nested);
                    }
                }
            }
            None
        }
        _ => {
            if output == value {
                Some(if current_path.is_empty() {
                    "result".to_string()
                } else {
                    current_path.to_string()
                })
            } else {
                None
            }
        }
    }
}

pub fn normalize_trace(raw: &Value) -> Result<AgentTrace, AuditError> {
    if let Value::Array(arr) = raw {
        let turns: Vec<TraceTurn> = serde_json::from_value(Value::Array(arr.clone()))
            .map_err(|e| AuditError::ParseError(e.to_string()))?;
        return Ok(AgentTrace {
            name: Some("imported-trace".to_string()),
            description: None,
            turns,
            model_cost_per_million_input: default_cost_input(),
            model_cost_per_million_output: default_cost_output(),
        });
    }

    if let Value::Object(map) = raw {
        if map.contains_key("turns") {
            return serde_json::from_value(raw.clone())
                .map_err(|e| AuditError::ParseError(e.to_string()));
        }

        if let Some(Value::Array(steps)) = map.get("steps") {
            let turns: Vec<TraceTurn> = serde_json::from_value(Value::Array(steps.clone()))
                .map_err(|e| AuditError::ParseError(e.to_string()))?;
            let name = map
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            return Ok(AgentTrace {
                name,
                description: None,
                turns,
                model_cost_per_million_input: default_cost_input(),
                model_cost_per_million_output: default_cost_output(),
            });
        }

        if let Some(Value::Array(messages)) = map.get("messages") {
            let mut extracted_turns = Vec::new();
            let mut tool_outputs = HashMap::new();

            for msg in messages {
                if msg.get("role").and_then(|r| r.as_str()) == Some("tool") {
                    if let Some(call_id) = msg.get("tool_call_id").and_then(|id| id.as_str()) {
                        let content_val = match msg.get("content") {
                            Some(Value::String(s)) => {
                                serde_json::from_str(s).unwrap_or_else(|_| Value::String(s.clone()))
                            }
                            Some(v) => v.clone(),
                            None => Value::Null,
                        };
                        tool_outputs.insert(call_id.to_string(), content_val);
                    }
                }
            }

            for msg in messages {
                if msg.get("role").and_then(|r| r.as_str()) == Some("assistant") {
                    if let Some(Value::Array(tool_calls)) = msg.get("tool_calls") {
                        for tc in tool_calls {
                            let id = tc.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let tool = tc
                                .get("function")
                                .and_then(|f| f.get("name"))
                                .and_then(|n| n.as_str())
                                .unwrap_or("unknown_tool")
                                .to_string();

                            let mut args = Map::new();
                            if let Some(raw_args) =
                                tc.get("function").and_then(|f| f.get("arguments"))
                            {
                                match raw_args {
                                    Value::String(s) => {
                                        if let Ok(Value::Object(parsed_map)) =
                                            serde_json::from_str(s)
                                        {
                                            args = parsed_map;
                                        }
                                    }
                                    Value::Object(m) => {
                                        args = m.clone();
                                    }
                                    _ => {}
                                }
                            }

                            let output = id
                                .as_ref()
                                .and_then(|call_id| tool_outputs.get(call_id).cloned());

                            extracted_turns.push(TraceTurn {
                                id,
                                tool,
                                arguments: args,
                                output,
                                requires_judgment: false,
                                tokens: None,
                                duration_ms: None,
                            });
                        }
                    }
                }
            }

            if !extracted_turns.is_empty() {
                let name = map
                    .get("name")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                return Ok(AgentTrace {
                    name,
                    description: None,
                    turns: extracted_turns,
                    model_cost_per_million_input: default_cost_input(),
                    model_cost_per_million_output: default_cost_output(),
                });
            }
        }
    }

    Err(AuditError::ParseError(
        "Unsupported trace format".to_string(),
    ))
}

pub fn compile_trace_to_plan(trace: &AgentTrace) -> Result<ExecutionPlan, AuditError> {
    if trace.turns.is_empty() {
        return Err(AuditError::EmptyTrace);
    }

    let mut steps: Vec<PlanStep> = Vec::new();
    let mut permissions = HashSet::new();
    let mut outputs_to_include = Vec::new();
    let mut previous_outputs: HashMap<String, Value> = HashMap::new();

    for (index, turn) in trace.turns.iter().enumerate() {
        let step_id = turn.id.clone().unwrap_or_else(|| {
            format!(
                "step_{}_{}",
                index + 1,
                turn.tool.replace(|c: char| !c.is_alphanumeric(), "_")
            )
        });

        let is_write = is_write_tool(&turn.tool);
        let action = if is_write { "write" } else { "read" };
        permissions.insert(format!("tools:{}:{action}", turn.tool));

        let mut depends_on = HashSet::new();
        let mut transformed_args = Map::new();

        for (arg_key, arg_val) in &turn.arguments {
            let mut matched_ref = None;

            for (prev_id, prev_out) in &previous_outputs {
                if let Some(path) = find_matching_path(arg_val, prev_out, "") {
                    let mut ref_map = Map::new();
                    ref_map.insert("from".to_string(), Value::String(prev_id.clone()));
                    ref_map.insert("path".to_string(), Value::String(path));
                    matched_ref = Some(Value::Object(ref_map));
                    depends_on.insert(prev_id.clone());
                    break;
                }
            }

            if let Some(ref_val) = matched_ref {
                transformed_args.insert(arg_key.clone(), ref_val);
            } else {
                transformed_args.insert(arg_key.clone(), arg_val.clone());
            }
        }

        if depends_on.is_empty() && index > 0 && is_write {
            depends_on.insert(steps[index - 1].id.clone());
        }

        if let Some(ref out) = turn.output {
            previous_outputs.insert(step_id.clone(), out.clone());
        }

        steps.push(PlanStep {
            id: step_id.clone(),
            tool: turn.tool.clone(),
            depends_on: depends_on.into_iter().collect(),
            arguments: transformed_args,
            output: None,
            requires_judgment: turn.requires_judgment,
            timeout_ms: None,
            idempotency_key: None,
        });

        outputs_to_include.push(step_id);
    }

    let raw_name = trace
        .name
        .clone()
        .unwrap_or_else(|| "compiled-pipeline".to_string());
    let clean_name = raw_name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    let plan_name = if clean_name.is_empty() {
        "compiled-pipeline".to_string()
    } else {
        clean_name
    };

    Ok(ExecutionPlan {
        api_version: "x.dev/v1alpha1".to_string(),
        kind: "ExecutionPlan".to_string(),
        metadata: PlanMetadata {
            name: plan_name,
            correlation_id: None,
        },
        spec: PlanSpec {
            limits: PlanLimits {
                max_steps: steps.len() + 10,
                timeout_ms: 60000,
                max_result_bytes: 1048576,
            },
            permissions: permissions.into_iter().collect(),
            steps,
            output: PlanOutputSpec {
                include: outputs_to_include,
            },
        },
    })
}

pub fn calculate_audit_savings(trace: &AgentTrace) -> AuditSavings {
    let turn_count = trace.turns.len();
    let judgment_count = trace.turns.iter().filter(|t| t.requires_judgment).count();

    let baseline_round_trips = turn_count + 1;
    let project_x_round_trips = 1 + judgment_count;
    let round_trips_saved = baseline_round_trips.saturating_sub(project_x_round_trips);

    let mut baseline_tokens = 0;
    let mut accumulated_context = 1200;

    for turn in &trace.turns {
        let input_tok = turn
            .tokens
            .as_ref()
            .and_then(|t| t.input)
            .unwrap_or(accumulated_context);
        let output_tok = turn.tokens.as_ref().and_then(|t| t.output).unwrap_or(250);
        baseline_tokens += input_tok + output_tok;
        let est_result_tokens = turn
            .output
            .as_ref()
            .map(|o| serde_json::to_string(o).unwrap_or_default().len() / 4)
            .unwrap_or(150);
        accumulated_context += est_result_tokens + 80;
    }
    baseline_tokens += accumulated_context + 300;

    let plan_tokens = 450 + turn_count * 80;
    let receipt_tokens = 350 + turn_count * 40;
    let final_synthesis_tokens = 400;
    let project_x_tokens = 1200 + plan_tokens + receipt_tokens + final_synthesis_tokens;

    let tokens_saved = baseline_tokens.saturating_sub(project_x_tokens);
    let token_savings_percentage = if baseline_tokens > 0 {
        ((tokens_saved as f64 / baseline_tokens as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    let cost_per_input = trace.model_cost_per_million_input / 1_000_000.0;
    let cost_per_output = trace.model_cost_per_million_output / 1_000_000.0;

    let estimated_baseline_cost_usd = (baseline_tokens as f64 * 0.8) * cost_per_input
        + (baseline_tokens as f64 * 0.2) * cost_per_output;
    let estimated_project_x_cost_usd = (project_x_tokens as f64 * 0.8) * cost_per_input
        + (project_x_tokens as f64 * 0.2) * cost_per_output;
    let cost_savings_usd = (estimated_baseline_cost_usd - estimated_project_x_cost_usd).max(0.0);

    let estimated_latency_reduction_ms = (round_trips_saved as u64) * 1400;

    AuditSavings {
        baseline_round_trips,
        project_x_round_trips,
        round_trips_saved,
        baseline_tokens,
        project_x_tokens,
        tokens_saved,
        token_savings_percentage,
        estimated_baseline_cost_usd: (estimated_baseline_cost_usd * 10000.0).round() / 10000.0,
        estimated_project_x_cost_usd: (estimated_project_x_cost_usd * 10000.0).round() / 10000.0,
        cost_savings_usd: (cost_savings_usd * 10000.0).round() / 10000.0,
        estimated_latency_reduction_ms,
    }
}

pub fn audit_trace(raw: &Value) -> Result<AuditReport, AuditError> {
    let trace = normalize_trace(raw)?;
    let generated_plan = compile_trace_to_plan(&trace)?;
    let savings = calculate_audit_savings(&trace);

    let mut read_tools = HashSet::new();
    let mut write_tools = HashSet::new();

    for turn in &trace.turns {
        if is_write_tool(&turn.tool) {
            write_tools.insert(turn.tool.clone());
        } else {
            read_tools.insert(turn.tool.clone());
        }
    }

    let security = SecurityAuditResult {
        read_tools: read_tools.into_iter().collect(),
        write_tools: write_tools.into_iter().collect(),
        permissions_required: generated_plan.spec.permissions.clone(),
        judgment_steps_count: trace.turns.iter().filter(|t| t.requires_judgment).count(),
        automated_steps_count: trace.turns.iter().filter(|t| !t.requires_judgment).count(),
    };

    let plan_yaml = serde_yaml::to_string(&generated_plan)
        .map_err(|e| AuditError::ParseError(e.to_string()))?;

    let trace_name = trace.name.unwrap_or_else(|| "agent-trace".to_string());
    let generated_at = Utc::now().to_rfc3339();

    let markdown_summary = format!(
        r#"# Project X Agent Audit Report
**Trace Name:** {trace_name}
**Generated At:** {generated_at}

## 1. Economic & Latency Optimization
| Metric | Baseline (Native Agent) | Project X Execution | Savings |
| :--- | :--- | :--- | :--- |
| **Model Round Trips** | {b_rt} | {px_rt} | **{rt_saved} ({rt_saved_pct}%)** |
| **Estimated Context Tokens** | {b_tok} | {px_tok} | **{tok_saved} ({tok_saved_pct:.1}%)** |
| **Estimated LLM Cost** | ${b_cost:.4} | ${px_cost:.4} | **${cost_saved:.4}** |
| **Estimated Latency Saved** | Baseline | -{lat_s:.1}s | **~{lat_ms}ms** |

## 2. Security & Boundary Analysis
- **Read Tools Identified ({n_read}):** {read_list}
- **Write / Side-Effect Tools ({n_write}):** {write_list}
- **Automated Deterministic Steps:** {auto_steps}
- **Steps Yielding to Model (Judgment):** {judg_steps}
- **Enforced Permissions:** `{perms}`

## 3. Compiled Declarative Plan
```yaml
{plan_yaml_trimmed}
```
"#,
        b_rt = savings.baseline_round_trips,
        px_rt = savings.project_x_round_trips,
        rt_saved = savings.round_trips_saved,
        rt_saved_pct = (savings.round_trips_saved as f64 / savings.baseline_round_trips as f64
            * 100.0)
            .round() as usize,
        b_tok = savings.baseline_tokens,
        px_tok = savings.project_x_tokens,
        tok_saved = savings.tokens_saved,
        tok_saved_pct = savings.token_savings_percentage,
        b_cost = savings.estimated_baseline_cost_usd,
        px_cost = savings.estimated_project_x_cost_usd,
        cost_saved = savings.cost_savings_usd,
        lat_s = savings.estimated_latency_reduction_ms as f64 / 1000.0,
        lat_ms = savings.estimated_latency_reduction_ms,
        n_read = security.read_tools.len(),
        read_list = security.read_tools.join(", "),
        n_write = security.write_tools.len(),
        write_list = security.write_tools.join(", "),
        auto_steps = security.automated_steps_count,
        judg_steps = security.judgment_steps_count,
        perms = security.permissions_required.join("`, `"),
        plan_yaml_trimmed = plan_yaml.trim(),
    );

    Ok(AuditReport {
        trace_name,
        generated_at,
        generated_plan,
        plan_yaml,
        savings,
        security,
        markdown_summary,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TraceGeneratorConfig {
    #[serde(default = "default_generator_scenario")]
    pub scenario: String,
    #[serde(default = "default_generator_scale")]
    pub scale: usize,
    #[serde(default = "default_generator_format")]
    pub format: String,
}

fn default_generator_scenario() -> String {
    "cloud-incident".to_string()
}

fn default_generator_scale() -> usize {
    20
}

fn default_generator_format() -> String {
    "openai".to_string()
}

impl Default for TraceGeneratorConfig {
    fn default() -> Self {
        Self {
            scenario: default_generator_scenario(),
            scale: default_generator_scale(),
            format: default_generator_format(),
        }
    }
}

fn build_cloud_incident_turns(scale: usize) -> (String, Vec<TraceTurn>) {
    let service_names = [
        "checkout-api",
        "auth-gateway",
        "risk-engine",
        "ledger-sync",
        "notification-worker",
        "search-indexer",
        "billing-coordinator",
        "order-router",
    ];

    let count = scale.max(3);
    let mut deployments = Vec::with_capacity(count);

    for i in 0..count {
        let base_name = service_names[i % service_names.len()];
        let dep_id = format!("dep-k8s-{:04x}", i + 1000);
        let svc_name = format!("{}-{}", base_name, i);

        let pod_count = 3.max(scale.min(5));
        let mut pods = Vec::with_capacity(pod_count);
        for p in 0..pod_count {
            pods.push(json!({
                "pod_id": format!("pod-{}-{:04x}", base_name, p),
                "node": format!("node-c5-{}", p % 10),
                "ip": format!("10.244.{}.{}", (i % 250) + 1, (p % 250) + 1),
                "status": if i == 0 && p == 0 { "CrashLoopBackOff" } else { "Running" },
                "restart_count": if i == 0 { 14 } else { 0 },
                "started_at": "2026-10-25T08:00:00Z"
            }));
        }

        deployments.push(json!({
            "deployment_id": dep_id,
            "name": svc_name,
            "namespace": "payments",
            "cluster": "prod-us-east-1",
            "replicas": {
                "desired": 6,
                "ready": if i == 0 { 1 } else { 6 },
                "available": if i == 0 { 1 } else { 6 },
                "unavailable": if i == 0 { 5 } else { 0 }
            },
            "status": if i == 0 { "CrashLoopBackOff" } else { "Running" },
            "image": format!("ecr.internal/core/{}:v3.18.{}", base_name, i),
            "labels": {
                "env": "production",
                "tier": "critical",
                "region": "us-east-1",
                "team": "core-infra"
            },
            "resources": {
                "limits": { "cpu": "2000m", "memory": "4Gi" },
                "requests": { "cpu": "500m", "memory": "1Gi" }
            },
            "pods": pods
        }));
    }

    let target_dep_id = format!("dep-k8s-{:04x}", 1000);
    let target_pod_id = format!("pod-{}-{:04x}", service_names[0], 0);

    let mut log_entries = Vec::with_capacity(count);
    for l in 0..count {
        log_entries.push(json!({
            "timestamp": format!("2026-10-25T08:{:02}:{:02}Z", (l / 60) % 60, l % 60),
            "level": if l % 5 == 0 { "FATAL" } else if l % 2 == 0 { "ERROR" } else { "WARN" },
            "thread": format!("reactor-http-epoll-{}", l % 8),
            "trace_id": format!("tr-99b821-{:04x}", l),
            "message": if l % 5 == 0 {
                "java.lang.OutOfMemoryError: Java heap space"
            } else {
                "Connection pool exhausted waiting for available channel"
            }
        }));
    }

    let mut metrics_series = Vec::with_capacity(count);
    for m in 0..count {
        metrics_series.push(json!({
            "timestamp": format!("2026-10-25T08:{:02}:00Z", m % 60),
            "cpu_utilization": 0.45 + ((m % 10) as f64 * 0.03),
            "memory_rss_bytes": 4150000000_u64 + ((m as u64) * 1024),
            "oom_events": if m > 10 { 1 } else { 0 },
            "p99_latency_ms": 320 + (m * 4)
        }));
    }

    let mut turn1_args = Map::new();
    turn1_args.insert(
        "cluster".to_string(),
        Value::String("prod-us-east-1".to_string()),
    );
    turn1_args.insert(
        "namespace".to_string(),
        Value::String("payments".to_string()),
    );

    let mut turn2_args = Map::new();
    turn2_args.insert("pod_id".to_string(), Value::String(target_pod_id));
    turn2_args.insert(
        "namespace".to_string(),
        Value::String("payments".to_string()),
    );
    turn2_args.insert(
        "tail_lines".to_string(),
        Value::Number(serde_json::Number::from(250)),
    );

    let mut turn3_args = Map::new();
    turn3_args.insert(
        "deployment_id".to_string(),
        Value::String(target_dep_id.clone()),
    );
    turn3_args.insert("timeframe".to_string(), Value::String("2h".to_string()));

    let mut turn4_args = Map::new();
    turn4_args.insert(
        "deployment_id".to_string(),
        Value::String(target_dep_id.clone()),
    );
    turn4_args.insert("memory_limit".to_string(), Value::String("8Gi".to_string()));

    let mut turn5_args = Map::new();
    turn5_args.insert(
        "channel".to_string(),
        Value::String("#incident-response".to_string()),
    );
    turn5_args.insert(
        "incident_id".to_string(),
        Value::String("inc-prod-8842".to_string()),
    );
    turn5_args.insert("status".to_string(), Value::String("resolved".to_string()));

    let turns = vec![
        TraceTurn {
            id: Some("turn_1_list_deployments".to_string()),
            tool: "k8s_list_deployments".to_string(),
            arguments: turn1_args,
            output: Some(json!({
                "cluster": "prod-us-east-1",
                "namespace": "payments",
                "total": count,
                "items": deployments
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(1200),
                output: Some(850 + count * 45),
            }),
            duration_ms: Some(310),
        },
        TraceTurn {
            id: Some("turn_2_get_pod_logs".to_string()),
            tool: "k8s_get_pod_logs".to_string(),
            arguments: turn2_args,
            output: Some(json!({
                "incident_id": "inc-prod-8842",
                "error_count": 42,
                "root_cause": "java.lang.OutOfMemoryError: Java heap space",
                "log_entries": log_entries
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(2100 + count * 45),
                output: Some(1450 + count * 30),
            }),
            duration_ms: Some(420),
        },
        TraceTurn {
            id: Some("turn_3_query_metrics".to_string()),
            tool: "telemetry_query_metrics".to_string(),
            arguments: turn3_args,
            output: Some(json!({
                "deployment_id": target_dep_id,
                "datapoints": metrics_series,
                "recommended_memory_limit": "8Gi"
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(3600),
                output: Some(920),
            }),
            duration_ms: Some(280),
        },
        TraceTurn {
            id: Some("turn_4_patch_deployment".to_string()),
            tool: "k8s_patch_deployment".to_string(),
            arguments: turn4_args,
            output: Some(json!({
                "deployment_id": target_dep_id,
                "status": "RollingUpdateInitiated",
                "generation": 14
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(4550),
                output: Some(320),
            }),
            duration_ms: Some(540),
        },
        TraceTurn {
            id: Some("turn_5_slack_notify".to_string()),
            tool: "slack_post_message".to_string(),
            arguments: turn5_args,
            output: Some(json!({
                "ok": true,
                "channel": "#incident-response",
                "timestamp": "1730000000.000100"
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(4900),
                output: Some(180),
            }),
            duration_ms: Some(190),
        },
    ];

    ("synthetic-cloud-incident-triage".to_string(), turns)
}

fn build_fintech_reconciliation_turns(scale: usize) -> (String, Vec<TraceTurn>) {
    let count = scale.max(3);
    let mut charges = Vec::with_capacity(count);

    for i in 0..count {
        let ch_id = format!("ch_3P{:08x}", i + 5000);
        let cus_id = format!("cus_N{:06x}", i + 200);

        charges.push(json!({
            "charge_id": ch_id,
            "customer_id": cus_id,
            "amount_cents": 19999 + i * 500,
            "currency": "usd",
            "status": if i == 0 { "failed" } else { "succeeded" },
            "failure_code": if i == 0 { "card_declined" } else { "none" },
            "card_fingerprint": format!("card_fp_{:06x}", i + 10),
            "risk_score": if i == 0 { 24 } else { 4 }
        }));
    }

    let target_charge_id = format!("ch_3P{:08x}", 5000);
    let target_customer_id = format!("cus_N{:06x}", 200);

    let mut turn1_args = Map::new();
    turn1_args.insert(
        "limit".to_string(),
        Value::Number(serde_json::Number::from(count)),
    );
    turn1_args.insert("status".to_string(), Value::String("failed".to_string()));

    let mut turn2_args = Map::new();
    turn2_args.insert(
        "customer_id".to_string(),
        Value::String(target_customer_id.clone()),
    );

    let mut turn3_args = Map::new();
    turn3_args.insert("customer_id".to_string(), Value::String(target_customer_id));
    turn3_args.insert(
        "charge_id".to_string(),
        Value::String(target_charge_id.clone()),
    );

    let mut turn4_args = Map::new();
    turn4_args.insert(
        "charge_id".to_string(),
        Value::String(target_charge_id.clone()),
    );
    turn4_args.insert(
        "action".to_string(),
        Value::String("retry_with_capture".to_string()),
    );

    let mut turn5_args = Map::new();
    turn5_args.insert(
        "charge_id".to_string(),
        Value::String(target_charge_id.clone()),
    );
    turn5_args.insert("status".to_string(), Value::String("succeeded".to_string()));

    let turns = vec![
        TraceTurn {
            id: Some("turn_1_list_failed_charges".to_string()),
            tool: "stripe_list_failed_charges".to_string(),
            arguments: turn1_args,
            output: Some(json!({
                "object": "list",
                "total_count": count,
                "data": charges
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(1100),
                output: Some(600 + count * 50),
            }),
            duration_ms: Some(210),
        },
        TraceTurn {
            id: Some("turn_2_query_customer".to_string()),
            tool: "db_query_customer_account".to_string(),
            arguments: turn2_args,
            output: Some(json!({
                "customer_id": format!("cus_N{:06x}", 200),
                "tier": "enterprise",
                "status": "active",
                "payment_methods": [
                    { "id": "pm_9921", "type": "card", "brand": "visa", "last4": "4242" }
                ],
                "account_balance_cents": 500000
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(1800 + count * 50),
                output: Some(450),
            }),
            duration_ms: Some(160),
        },
        TraceTurn {
            id: Some("turn_3_risk_assess".to_string()),
            tool: "risk_assess_transaction".to_string(),
            arguments: turn3_args,
            output: Some(json!({
                "charge_id": target_charge_id.clone(),
                "verdict": "allow_retry",
                "risk_score": 12,
                "fraud_indicators": []
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(2500),
                output: Some(220),
            }),
            duration_ms: Some(180),
        },
        TraceTurn {
            id: Some("turn_4_retry_charge".to_string()),
            tool: "stripe_retry_charge".to_string(),
            arguments: turn4_args,
            output: Some(json!({
                "charge_id": target_charge_id.clone(),
                "status": "succeeded",
                "amount_settled": 19999
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(3100),
                output: Some(300),
            }),
            duration_ms: Some(490),
        },
        TraceTurn {
            id: Some("turn_5_record_ledger".to_string()),
            tool: "ledger_record_transaction".to_string(),
            arguments: turn5_args,
            output: Some(json!({
                "ledger_entry_id": "led-entry-88912",
                "charge_id": target_charge_id,
                "status": "reconciled",
                "balanced": true
            })),
            requires_judgment: false,
            tokens: Some(TokenUsage {
                input: Some(3600),
                output: Some(180),
            }),
            duration_ms: Some(150),
        },
    ];

    ("synthetic-fintech-reconciliation".to_string(), turns)
}

pub fn generate_synthetic_trace(config: &TraceGeneratorConfig) -> Value {
    let (name, turns) = if config.scenario == "fintech" || config.scenario == "billing" {
        build_fintech_reconciliation_turns(config.scale)
    } else {
        build_cloud_incident_turns(config.scale)
    };

    if config.format.to_lowercase() == "openai" {
        let mut messages = Vec::new();

        messages.push(json!({
            "role": "user",
            "content": format!("Execute autonomous triage scenario: {}", name)
        }));

        for turn in &turns {
            let call_id = turn.id.clone().unwrap_or_else(|| "call_0".to_string());
            let args_str =
                serde_json::to_string(&turn.arguments).unwrap_or_else(|_| "{}".to_string());

            messages.push(json!({
                "role": "assistant",
                "content": Value::Null,
                "tool_calls": [
                    {
                        "id": call_id.clone(),
                        "type": "function",
                        "function": {
                            "name": turn.tool.clone(),
                            "arguments": args_str
                        }
                    }
                ]
            }));

            let output_str = match &turn.output {
                Some(out) => serde_json::to_string(out).unwrap_or_else(|_| "{}".to_string()),
                None => "{}".to_string(),
            };

            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": output_str
            }));
        }

        json!({
            "name": name,
            "messages": messages
        })
    } else {
        json!({
            "name": name,
            "turns": turns,
            "modelCostPerMillionInput": default_cost_input(),
            "modelCostPerMillionOutput": default_cost_output()
        })
    }
}
