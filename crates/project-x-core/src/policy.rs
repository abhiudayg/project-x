use crate::types::{ExecutionPlan, PolicyDecisionRecord};
use regex::Regex;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PolicyError {
    #[error("Write operation '{0}' denied by runtime policy (allowWrites=false)")]
    WriteDenied(String),
    #[error("Permission '{0}' requested by plan is not granted")]
    PermissionDenied(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimePolicy {
    #[serde(default = "default_allow_writes", rename = "allowWrites")]
    pub allow_writes: bool,
    #[serde(default, rename = "grantedPermissions")]
    pub granted_permissions: Vec<String>,
}

fn default_allow_writes() -> bool {
    false
}

impl Default for RuntimePolicy {
    fn default() -> Self {
        Self {
            allow_writes: default_allow_writes(),
            granted_permissions: Vec::new(),
        }
    }
}

pub struct PolicyEngine {
    policy: RuntimePolicy,
    read_prefix_regex: Regex,
    write_verb_regex: Regex,
}

impl PolicyEngine {
    pub fn new(policy: RuntimePolicy) -> Self {
        let read_prefix_regex = Regex::new(
            r"^(get|list|fetch|read|describe|scan|check|query|find|inspect|search)(_|\.|$)",
        )
        .unwrap();
        let write_verb_regex = Regex::new(
            r"^(create|delete|remove|write|update|patch|post|deploy|restart|kill|set|apply)(_|\.|$)|(_|\.)(create|delete|remove|write|update|patch|post|deploy|restart|kill|set|apply)$",
        )
        .unwrap();

        Self {
            policy,
            read_prefix_regex,
            write_verb_regex,
        }
    }

    pub fn is_write_tool(&self, tool_name: &str) -> bool {
        if self.read_prefix_regex.is_match(tool_name) {
            return false;
        }
        self.write_verb_regex.is_match(tool_name)
    }

    pub fn validate_plan_pre_execution(
        &self,
        plan: &ExecutionPlan,
    ) -> Result<Vec<PolicyDecisionRecord>, PolicyError> {
        let mut decisions = Vec::new();

        if !self.policy.granted_permissions.is_empty() {
            for perm in &plan.spec.permissions {
                if !self.policy.granted_permissions.contains(perm) {
                    decisions.push(PolicyDecisionRecord {
                        phase: "pre_execution".to_string(),
                        target: perm.clone(),
                        action: "permission".to_string(),
                        decision: "denied".to_string(),
                        reason: Some("Permission not granted in runtime policy".to_string()),
                    });
                    return Err(PolicyError::PermissionDenied(perm.clone()));
                }
            }
        }

        for step in &plan.spec.steps {
            let is_write = self.is_write_tool(&step.tool);
            let action = if is_write { "write" } else { "read" };

            if is_write && !self.policy.allow_writes {
                decisions.push(PolicyDecisionRecord {
                    phase: "pre_execution".to_string(),
                    target: step.tool.clone(),
                    action: action.to_string(),
                    decision: "denied".to_string(),
                    reason: Some("Write operations disallowed by policy".to_string()),
                });
                return Err(PolicyError::WriteDenied(step.tool.clone()));
            }

            decisions.push(PolicyDecisionRecord {
                phase: "pre_execution".to_string(),
                target: step.tool.clone(),
                action: action.to_string(),
                decision: "granted".to_string(),
                reason: None,
            });
        }

        Ok(decisions)
    }
}
