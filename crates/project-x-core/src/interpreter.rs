use crate::dag::build_dag;
use crate::parser::parse_plan;
use crate::policy::{PolicyEngine, RuntimePolicy};
use crate::resolver::resolve_arguments;
use crate::types::{
    ExecutionHandback, ExecutionMetrics, ExecutionReceipt, ExecutionStatus, ExecutionTimestamps,
    StepError, StepExecutionRecord, StepStatus, VerificationStatus,
};
use crate::verifier::verify_step_execution;
use async_trait::async_trait;
use chrono::Utc;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum InterpreterError {
    #[error("Parse error: {0}")]
    Parse(#[from] crate::parser::ParseError),
    #[error("DAG error: {0}")]
    Dag(#[from] crate::dag::DagError),
    #[error("Policy violation: {0}")]
    Policy(#[from] crate::policy::PolicyError),
    #[error("Resolution error: {0}")]
    Resolution(#[from] crate::resolver::ResolutionError),
}

#[async_trait]
pub trait ToolAdapter: Send + Sync {
    async fn list_tools(&self) -> Vec<String>;
    async fn execute(&self, name: &str, args: &Map<String, Value>) -> Result<Value, String>;
}

pub type ToolHandler = Arc<dyn Fn(&Map<String, Value>) -> Result<Value, String> + Send + Sync>;

pub struct InMemoryToolAdapter {
    handlers: HashMap<String, ToolHandler>,
}

impl InMemoryToolAdapter {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    pub fn register_tool<F>(&mut self, name: &str, handler: F)
    where
        F: Fn(&Map<String, Value>) -> Result<Value, String> + Send + Sync + 'static,
    {
        self.handlers.insert(name.to_string(), Arc::new(handler));
    }
}

impl Default for InMemoryToolAdapter {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ToolAdapter for InMemoryToolAdapter {
    async fn list_tools(&self) -> Vec<String> {
        self.handlers.keys().cloned().collect()
    }

    async fn execute(&self, name: &str, args: &Map<String, Value>) -> Result<Value, String> {
        if let Some(handler) = self.handlers.get(name) {
            handler(args)
        } else {
            Err(format!("Tool '{name}' not found in in-memory adapter"))
        }
    }
}

#[derive(Clone)]
pub struct ExecutionOptions {
    pub policy: RuntimePolicy,
    pub default_timeout_ms: u64,
}

impl Default for ExecutionOptions {
    fn default() -> Self {
        Self {
            policy: RuntimePolicy::default(),
            default_timeout_ms: 10000,
        }
    }
}

pub struct ExecutionResult {
    pub receipt: ExecutionReceipt,
    pub outputs: HashMap<String, Value>,
}

pub struct Interpreter<T: ToolAdapter> {
    adapter: Arc<T>,
    options: ExecutionOptions,
}

impl<T: ToolAdapter> Interpreter<T> {
    pub fn new(adapter: Arc<T>, options: ExecutionOptions) -> Self {
        Self { adapter, options }
    }

    pub async fn execute(&self, plan_input: &str) -> Result<ExecutionResult, InterpreterError> {
        let start_time = Instant::now();
        let started_at = Utc::now().to_rfc3339();

        let parsed = parse_plan(plan_input)?;
        let plan = parsed.plan;
        let plan_digest = parsed.digest;

        let dag = build_dag(&plan)?;

        let policy_engine = PolicyEngine::new(self.options.policy.clone());
        let policy_decisions = policy_engine.validate_plan_pre_execution(&plan)?;

        let mut step_outputs: HashMap<String, Value> = HashMap::new();
        let mut step_records: HashMap<String, StepExecutionRecord> = HashMap::new();
        let mut failed_or_skipped = false;
        let mut handback: Option<ExecutionHandback> = None;
        let mut total_bytes_processed = 0;

        let step_map: HashMap<String, _> = plan
            .spec
            .steps
            .iter()
            .map(|s| (s.id.clone(), s.clone()))
            .collect();

        'wave_loop: for wave in &dag.execution_waves {
            for step_id in wave {
                let step = &step_map[step_id];

                if step_records.get(step_id).map(|r| r.status) == Some(StepStatus::Skipped) {
                    continue;
                }

                let resolved_args = match resolve_arguments(&step.arguments, &step_outputs) {
                    Ok(args) => args,
                    Err(e) => {
                        let arg_hash = compute_arg_hash(&step.arguments);
                        step_records.insert(
                            step_id.clone(),
                            StepExecutionRecord {
                                tool: step.tool.clone(),
                                status: StepStatus::Failed,
                                duration_ms: 0,
                                attempts: 1,
                                argument_hash: arg_hash,
                                verification: VerificationStatus::Failed,
                                error: Some(StepError {
                                    code: "RESOLVER_ERROR".to_string(),
                                    message: e.to_string(),
                                }),
                            },
                        );

                        if let Some(downstream) = dag.transitive_downstream.get(step_id) {
                            for dep_id in downstream {
                                mark_skipped(&mut step_records, &step_map[dep_id]);
                            }
                        }
                        failed_or_skipped = true;
                        continue;
                    }
                };

                let arg_bytes = serde_json::to_vec(&resolved_args).unwrap_or_default();
                total_bytes_processed += arg_bytes.len();
                let argument_hash = compute_arg_hash(&resolved_args);

                let step_start = Instant::now();
                let timeout_duration = std::time::Duration::from_millis(
                    step.timeout_ms.unwrap_or(self.options.default_timeout_ms),
                );

                let exec_res = tokio::time::timeout(
                    timeout_duration,
                    self.adapter.execute(&step.tool, &resolved_args),
                )
                .await;

                let step_duration_ms = step_start.elapsed().as_millis() as u64;

                match exec_res {
                    Ok(Ok(output_val)) => {
                        let out_bytes = serde_json::to_vec(&output_val).unwrap_or_default();
                        total_bytes_processed += out_bytes.len();

                        let verification = verify_step_execution(&step.tool, &output_val, None);

                        step_records.insert(
                            step_id.clone(),
                            StepExecutionRecord {
                                tool: step.tool.clone(),
                                status: StepStatus::Success,
                                duration_ms: step_duration_ms,
                                attempts: 1,
                                argument_hash,
                                verification,
                                error: None,
                            },
                        );

                        step_outputs.insert(step_id.clone(), output_val);

                        if step.requires_judgment {
                            handback = Some(ExecutionHandback {
                                step_id: step_id.clone(),
                                reason: "requiresJudgment".to_string(),
                            });
                            break 'wave_loop;
                        }
                    }
                    Ok(Err(err_msg)) => {
                        step_records.insert(
                            step_id.clone(),
                            StepExecutionRecord {
                                tool: step.tool.clone(),
                                status: StepStatus::Failed,
                                duration_ms: step_duration_ms,
                                attempts: 1,
                                argument_hash,
                                verification: VerificationStatus::Failed,
                                error: Some(StepError {
                                    code: "TOOL_EXECUTION_ERROR".to_string(),
                                    message: err_msg,
                                }),
                            },
                        );

                        if let Some(downstream) = dag.transitive_downstream.get(step_id) {
                            for dep_id in downstream {
                                mark_skipped(&mut step_records, &step_map[dep_id]);
                            }
                        }
                        failed_or_skipped = true;
                    }
                    Err(_) => {
                        step_records.insert(
                            step_id.clone(),
                            StepExecutionRecord {
                                tool: step.tool.clone(),
                                status: StepStatus::TimedOut,
                                duration_ms: step_duration_ms,
                                attempts: 1,
                                argument_hash,
                                verification: VerificationStatus::Failed,
                                error: Some(StepError {
                                    code: "TIMEOUT".to_string(),
                                    message: format!(
                                        "Step timed out after {}ms",
                                        timeout_duration.as_millis()
                                    ),
                                }),
                            },
                        );

                        if let Some(downstream) = dag.transitive_downstream.get(step_id) {
                            for dep_id in downstream {
                                mark_skipped(&mut step_records, &step_map[dep_id]);
                            }
                        }
                        failed_or_skipped = true;
                    }
                }
            }
        }

        let completed_at = Utc::now().to_rfc3339();
        let total_duration_ms = start_time.elapsed().as_millis() as u64;

        let status = if handback.is_some() {
            ExecutionStatus::Incomplete
        } else if failed_or_skipped {
            ExecutionStatus::Failed
        } else {
            ExecutionStatus::Complete
        };

        let mut final_outputs = HashMap::new();
        for inc_id in &plan.spec.output.include {
            if let Some(val) = step_outputs.get(inc_id) {
                final_outputs.insert(inc_id.clone(), val.clone());
            }
        }

        let receipt = ExecutionReceipt {
            plan_id: plan.metadata.name.clone(),
            schema_version: plan.api_version.clone(),
            plan_digest,
            execution_id: Uuid::new_v4().to_string(),
            timestamps: ExecutionTimestamps {
                started_at,
                completed_at,
                duration_ms: total_duration_ms,
            },
            status,
            handback,
            steps: step_records,
            outputs: final_outputs.clone(),
            policy_decisions,
            metrics: ExecutionMetrics {
                total_bytes_processed,
                interpreter_overhead_ms: 1,
            },
        };

        Ok(ExecutionResult {
            receipt,
            outputs: final_outputs,
        })
    }
}

fn compute_arg_hash(args: &Map<String, Value>) -> String {
    let bytes = serde_json::to_vec(args).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    hex::encode(hasher.finalize())
}

fn mark_skipped(records: &mut HashMap<String, StepExecutionRecord>, step: &crate::types::PlanStep) {
    if !records.contains_key(&step.id) {
        records.insert(
            step.id.clone(),
            StepExecutionRecord {
                tool: step.tool.clone(),
                status: StepStatus::Skipped,
                duration_ms: 0,
                attempts: 0,
                argument_hash: compute_arg_hash(&step.arguments),
                verification: VerificationStatus::Unverified,
                error: None,
            },
        );
    }
}
