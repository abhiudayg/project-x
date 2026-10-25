use napi::bindgen_prelude::*;
use napi_derive::napi;
use project_x_core::{audit_trace as core_audit, build_dag, parse_plan as core_parse};

#[napi(object)]
pub struct JsPlanValidation {
    pub valid: bool,
    pub name: String,
    pub api_version: String,
    pub digest: String,
    pub steps_count: u32,
    pub waves_count: u32,
    pub topological_order: Vec<String>,
}

#[napi]
pub fn validate_plan(plan_yaml: String) -> Result<JsPlanValidation> {
    let parsed = core_parse(&plan_yaml)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Parse error: {e}")))?;

    let dag = build_dag(&parsed.plan)
        .map_err(|e| Error::new(Status::InvalidArg, format!("DAG error: {e}")))?;

    Ok(JsPlanValidation {
        valid: true,
        name: parsed.plan.metadata.name,
        api_version: parsed.plan.api_version,
        digest: parsed.digest,
        steps_count: parsed.plan.spec.steps.len() as u32,
        waves_count: dag.execution_waves.len() as u32,
        topological_order: dag.topological_order,
    })
}

#[napi]
pub fn compute_digest(plan_yaml: String) -> Result<String> {
    let parsed = core_parse(&plan_yaml)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Parse error: {e}")))?;
    Ok(parsed.digest)
}

#[napi]
pub fn audit_trace(trace_json: String) -> Result<String> {
    let val: serde_json::Value = serde_json::from_str(&trace_json)
        .map_err(|e| Error::new(Status::InvalidArg, format!("Invalid JSON: {e}")))?;

    let report = core_audit(&val)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Audit error: {e}")))?;

    serde_json::to_string_pretty(&report)
        .map_err(|e| Error::new(Status::GenericFailure, format!("Serialization error: {e}")))
}
