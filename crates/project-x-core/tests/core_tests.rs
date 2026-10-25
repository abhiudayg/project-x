use project_x_core::*;
use serde_json::json;
use std::sync::Arc;

#[test]
fn test_parse_valid_plan_yaml() {
    let yaml = r#"
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: test-plan
spec:
  limits:
    maxSteps: 10
    timeoutMs: 5000
    maxResultBytes: 1024
  permissions:
    - tools:echo:read
  steps:
    - id: step_one
      tool: echo
      arguments:
        msg: "hello rust"
  output:
    include:
      - step_one
"#;

    let parsed = parse_plan(yaml).expect("Valid YAML should parse");
    assert_eq!(parsed.plan.api_version, "x.dev/v1alpha1");
    assert_eq!(parsed.plan.kind, "ExecutionPlan");
    assert_eq!(parsed.plan.metadata.name, "test-plan");
    assert_eq!(parsed.plan.spec.steps.len(), 1);
    assert!(!parsed.digest.is_empty());
}

#[test]
fn test_parse_rejects_unsupported_api_version() {
    let yaml = r#"
apiVersion: v1
kind: ExecutionPlan
metadata:
  name: bad-version
spec:
  steps:
    - id: s1
      tool: echo
  output:
    include: [s1]
"#;

    let res = parse_plan(yaml);
    assert!(res.is_err());
}

#[test]
fn test_dag_cycle_detection() {
    let yaml = r#"
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: cyclic-plan
spec:
  steps:
    - id: step_a
      tool: echo
      dependsOn: [step_b]
    - id: step_b
      tool: echo
      dependsOn: [step_a]
  output:
    include: [step_a]
"#;

    let parsed = parse_plan(yaml).unwrap();
    let dag_res = build_dag(&parsed.plan);
    assert!(dag_res.is_err());
}

#[test]
fn test_path_extraction_and_resolution() {
    let root = json!({
        "data": {
            "users": [
                { "id": "u-101", "name": "Alice" },
                { "id": "u-102", "name": "Bob" }
            ]
        }
    });

    let val = extract_path(&root, "data.users[1].name").unwrap();
    assert_eq!(val, json!("Bob"));

    let val_id = extract_path(&root, "data.users[0].id").unwrap();
    assert_eq!(val_id, json!("u-101"));
}

#[tokio::test]
async fn test_interpreter_execution_and_resolution() {
    let mut adapter = InMemoryToolAdapter::new();
    adapter.register_tool("fetch_user", |_args| {
        Ok(json!({ "userId": "usr_99", "tier": "premium" }))
    });
    adapter.register_tool("fetch_billing", |args| {
        let user_id = args.get("userId").unwrap().as_str().unwrap();
        Ok(json!({ "account": user_id, "balance": 150.0 }))
    });

    let plan_yaml = r#"
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: multi-step-test
spec:
  permissions:
    - tools:fetch_user:read
    - tools:fetch_billing:read
  steps:
    - id: step_user
      tool: fetch_user
      arguments: {}
    - id: step_bill
      tool: fetch_billing
      dependsOn: [step_user]
      arguments:
        userId:
          from: step_user
          path: userId
  output:
    include:
      - step_bill
"#;

    let interpreter = Interpreter::new(
        Arc::new(adapter),
        ExecutionOptions {
            policy: RuntimePolicy {
                allow_writes: false,
                granted_permissions: vec![
                    "tools:fetch_user:read".to_string(),
                    "tools:fetch_billing:read".to_string(),
                ],
            },
            default_timeout_ms: 5000,
        },
    );

    let res = interpreter.execute(plan_yaml).await.unwrap();
    assert_eq!(res.receipt.status, ExecutionStatus::Complete);
    assert_eq!(
        res.outputs.get("step_bill").unwrap()["account"],
        json!("usr_99")
    );
}

#[tokio::test]
async fn test_policy_pre_execution_write_rejection() {
    let mut adapter = InMemoryToolAdapter::new();
    adapter.register_tool("delete_database", |_args| Ok(json!({ "deleted": true })));

    let plan_yaml = r#"
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: dangerous-write
spec:
  steps:
    - id: step_delete
      tool: delete_database
      arguments: {}
  output:
    include: [step_delete]
"#;

    let interpreter = Interpreter::new(
        Arc::new(adapter),
        ExecutionOptions {
            policy: RuntimePolicy {
                allow_writes: false,
                granted_permissions: Vec::new(),
            },
            default_timeout_ms: 5000,
        },
    );

    let res = interpreter.execute(plan_yaml).await;
    assert!(res.is_err());
}

#[tokio::test]
async fn test_requires_judgment_handback() {
    let mut adapter = InMemoryToolAdapter::new();
    adapter.register_tool("fetch_metrics", |_args| Ok(json!({ "anomalyScore": 0.95 })));
    adapter.register_tool("reboot", |_args| Ok(json!({ "rebooted": true })));

    let plan_yaml = r#"
apiVersion: x.dev/v1alpha1
kind: ExecutionPlan
metadata:
  name: triage-plan
spec:
  steps:
    - id: check_metrics
      tool: fetch_metrics
      requiresJudgment: true
      arguments: {}
    - id: fix_reboot
      tool: reboot
      dependsOn: [check_metrics]
      arguments: {}
  output:
    include: [check_metrics]
"#;

    let interpreter = Interpreter::new(
        Arc::new(adapter),
        ExecutionOptions {
            policy: RuntimePolicy {
                allow_writes: true,
                granted_permissions: Vec::new(),
            },
            default_timeout_ms: 5000,
        },
    );

    let res = interpreter.execute(plan_yaml).await.unwrap();
    assert_eq!(res.receipt.status, ExecutionStatus::Incomplete);
    assert_eq!(
        res.receipt.handback.unwrap().reason,
        "requiresJudgment".to_string()
    );
    assert!(!res.receipt.steps.contains_key("fix_reboot"));
}

#[test]
fn test_audit_trace_and_plan_synthesis() {
    let trace_json = json!({
        "name": "incident-triage",
        "turns": [
            {
                "id": "step_list",
                "tool": "list_deployments",
                "arguments": { "env": "prod" },
                "output": { "failingId": "dep-404" }
            },
            {
                "id": "step_logs",
                "tool": "fetch_logs",
                "arguments": { "deploymentId": "dep-404" },
                "output": { "error": "OOMKilled" }
            }
        ]
    });

    let report = audit_trace(&trace_json).expect("Trace should audit successfully");
    assert_eq!(report.trace_name, "incident-triage");
    assert_eq!(report.generated_plan.spec.steps.len(), 2);
    assert_eq!(report.savings.baseline_round_trips, 3);
    assert_eq!(report.savings.project_x_round_trips, 1);
    assert_eq!(report.savings.round_trips_saved, 2);
    assert!(report.savings.tokens_saved > 0);
    assert!(report.plan_yaml.contains("apiVersion: x.dev/v1alpha1"));
}
