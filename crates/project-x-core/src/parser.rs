use crate::types::ExecutionPlan;
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("Failed to parse plan YAML/JSON: {0}")]
    FormatError(String),
    #[error("Unsupported apiVersion '{0}'. Expected 'x.dev/v1alpha1'")]
    UnsupportedApiVersion(String),
    #[error("Unsupported kind '{0}'. Expected 'ExecutionPlan'")]
    UnsupportedKind(String),
    #[error("ExecutionPlan must declare at least one step")]
    EmptySteps,
}

#[derive(Debug, Clone)]
pub struct ParsedPlan {
    pub plan: ExecutionPlan,
    pub digest: String,
}

pub fn compute_plan_digest(plan: &ExecutionPlan) -> Result<String, ParseError> {
    let canonical_json =
        serde_json::to_vec(plan).map_err(|e| ParseError::FormatError(e.to_string()))?;
    let mut hasher = Sha256::new();
    hasher.update(&canonical_json);
    Ok(hex::encode(hasher.finalize()))
}

pub fn parse_plan(input: &str) -> Result<ParsedPlan, ParseError> {
    let plan: ExecutionPlan =
        serde_yaml::from_str(input).map_err(|e| ParseError::FormatError(e.to_string()))?;

    if plan.api_version != "x.dev/v1alpha1" {
        return Err(ParseError::UnsupportedApiVersion(plan.api_version));
    }

    if plan.kind != "ExecutionPlan" {
        return Err(ParseError::UnsupportedKind(plan.kind));
    }

    if plan.spec.steps.is_empty() {
        return Err(ParseError::EmptySteps);
    }

    let digest = compute_plan_digest(&plan)?;

    Ok(ParsedPlan { plan, digest })
}
