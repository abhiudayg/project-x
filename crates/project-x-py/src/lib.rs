#![allow(clippy::useless_conversion)]

use project_x_core::{
    audit_trace as core_audit, build_dag, parse_plan as core_parse, ExecutionOptions,
    InMemoryToolAdapter, Interpreter, RuntimePolicy,
};
use pyo3::exceptions::{PyRuntimeError, PyValueError};
use pyo3::prelude::*;
use std::sync::Arc;

#[pyclass]
#[derive(Clone)]
pub struct PlanValidation {
    #[pyo3(get)]
    pub valid: bool,
    #[pyo3(get)]
    pub name: String,
    #[pyo3(get)]
    pub api_version: String,
    #[pyo3(get)]
    pub digest: String,
    #[pyo3(get)]
    pub steps_count: usize,
    #[pyo3(get)]
    pub waves_count: usize,
    #[pyo3(get)]
    pub topological_order: Vec<String>,
}

#[pyfunction]
pub fn validate_plan(plan_yaml: &str) -> PyResult<PlanValidation> {
    let parsed =
        core_parse(plan_yaml).map_err(|e| PyValueError::new_err(format!("Parse error: {e}")))?;

    let dag =
        build_dag(&parsed.plan).map_err(|e| PyValueError::new_err(format!("DAG error: {e}")))?;

    Ok(PlanValidation {
        valid: true,
        name: parsed.plan.metadata.name,
        api_version: parsed.plan.api_version,
        digest: parsed.digest,
        steps_count: parsed.plan.spec.steps.len(),
        waves_count: dag.execution_waves.len(),
        topological_order: dag.topological_order,
    })
}

#[pyfunction]
pub fn compute_digest(plan_yaml: &str) -> PyResult<String> {
    let parsed =
        core_parse(plan_yaml).map_err(|e| PyValueError::new_err(format!("Parse error: {e}")))?;
    Ok(parsed.digest)
}

#[pyfunction]
pub fn audit_trace(trace_json_str: &str) -> PyResult<String> {
    let val: serde_json::Value = serde_json::from_str(trace_json_str)
        .map_err(|e| PyValueError::new_err(format!("Invalid trace JSON: {e}")))?;

    let report =
        core_audit(&val).map_err(|e| PyRuntimeError::new_err(format!("Audit error: {e}")))?;

    serde_json::to_string_pretty(&report)
        .map_err(|e| PyRuntimeError::new_err(format!("Serialization error: {e}")))
}

#[pyfunction]
#[pyo3(signature = (plan_yaml, policy_json=None))]
pub fn execute_plan(plan_yaml: &str, policy_json: Option<&str>) -> PyResult<String> {
    let runtime_policy = if let Some(p) = policy_json {
        serde_json::from_str::<RuntimePolicy>(p)
            .map_err(|e| PyValueError::new_err(format!("Invalid policy JSON: {e}")))?
    } else {
        RuntimePolicy::default()
    };

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| PyRuntimeError::new_err(format!("Tokio runtime error: {e}")))?;

    rt.block_on(async {
        let mut adapter = InMemoryToolAdapter::new();
        adapter.register_tool("echo", |args| Ok(serde_json::Value::Object(args.clone())));

        let options = ExecutionOptions {
            policy: runtime_policy,
            default_timeout_ms: 10000,
        };

        let interpreter = Interpreter::new(Arc::new(adapter), options);
        let result = interpreter
            .execute(plan_yaml)
            .await
            .map_err(|e| PyRuntimeError::new_err(format!("Execution error: {e}")))?;

        serde_json::to_string_pretty(&result.receipt)
            .map_err(|e| PyRuntimeError::new_err(format!("Receipt serialization error: {e}")))
    })
}

#[pymodule]
fn project_x(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PlanValidation>()?;
    m.add_function(wrap_pyfunction!(validate_plan, m)?)?;
    m.add_function(wrap_pyfunction!(compute_digest, m)?)?;
    m.add_function(wrap_pyfunction!(audit_trace, m)?)?;
    m.add_function(wrap_pyfunction!(execute_plan, m)?)?;
    Ok(())
}
