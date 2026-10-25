use crate::types::VerificationStatus;
use serde_json::Value;

pub fn verify_step_execution(
    _tool: &str,
    _output: &Value,
    verification_check: Option<bool>,
) -> VerificationStatus {
    match verification_check {
        Some(true) => VerificationStatus::Verified,
        Some(false) => VerificationStatus::Failed,
        None => VerificationStatus::Unverified,
    }
}
