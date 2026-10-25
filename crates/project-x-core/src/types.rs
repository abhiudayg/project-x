use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StepReference {
    pub from: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanLimits {
    #[serde(default = "default_max_steps", rename = "maxSteps")]
    pub max_steps: usize,
    #[serde(default = "default_timeout_ms", rename = "timeoutMs")]
    pub timeout_ms: u64,
    #[serde(default = "default_max_result_bytes", rename = "maxResultBytes")]
    pub max_result_bytes: usize,
}

fn default_max_steps() -> usize {
    50
}
fn default_timeout_ms() -> u64 {
    60000
}
fn default_max_result_bytes() -> usize {
    1048576
}

impl Default for PlanLimits {
    fn default() -> Self {
        Self {
            max_steps: default_max_steps(),
            timeout_ms: default_timeout_ms(),
            max_result_bytes: default_max_result_bytes(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanStepOutput {
    #[serde(default)]
    pub include: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanStep {
    pub id: String,
    pub tool: String,
    #[serde(default, rename = "dependsOn")]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub arguments: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub output: Option<PlanStepOutput>,
    #[serde(default, rename = "requiresJudgment")]
    pub requires_judgment: bool,
    #[serde(default, rename = "timeoutMs")]
    pub timeout_ms: Option<u64>,
    #[serde(default, rename = "idempotencyKey")]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanMetadata {
    pub name: String,
    #[serde(default, rename = "correlationId")]
    pub correlation_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanOutputSpec {
    pub include: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanSpec {
    #[serde(default)]
    pub limits: PlanLimits,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub steps: Vec<PlanStep>,
    pub output: PlanOutputSpec,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionPlan {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub kind: String,
    pub metadata: PlanMetadata,
    pub spec: PlanSpec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Success,
    Failed,
    Skipped,
    Cancelled,
    TimedOut,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    Verified,
    Failed,
    Unverified,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionStatus {
    Complete,
    Incomplete,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepExecutionRecord {
    pub tool: String,
    pub status: StepStatus,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
    pub attempts: usize,
    #[serde(rename = "argumentHash")]
    pub argument_hash: String,
    pub verification: VerificationStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<StepError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyDecisionRecord {
    pub phase: String,
    pub target: String,
    pub action: String,
    pub decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionTimestamps {
    #[serde(rename = "startedAt")]
    pub started_at: String,
    #[serde(rename = "completedAt")]
    pub completed_at: String,
    #[serde(rename = "durationMs")]
    pub duration_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionHandback {
    #[serde(rename = "stepId")]
    pub step_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionMetrics {
    #[serde(rename = "totalBytesProcessed")]
    pub total_bytes_processed: usize,
    #[serde(rename = "interpreterOverheadMs")]
    pub interpreter_overhead_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExecutionReceipt {
    #[serde(rename = "planId")]
    pub plan_id: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "planDigest")]
    pub plan_digest: String,
    #[serde(rename = "executionId")]
    pub execution_id: String,
    pub timestamps: ExecutionTimestamps,
    pub status: ExecutionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handback: Option<ExecutionHandback>,
    pub steps: HashMap<String, StepExecutionRecord>,
    pub outputs: HashMap<String, serde_json::Value>,
    #[serde(rename = "policyDecisions")]
    pub policy_decisions: Vec<PolicyDecisionRecord>,
    pub metrics: ExecutionMetrics,
}
