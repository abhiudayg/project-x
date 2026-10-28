use clap::{Parser, Subcommand};
use project_x_core::{
    audit_trace, build_dag, parse_plan, ExecutionOptions, Interpreter, RuntimePolicy,
};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

#[derive(Parser)]
#[command(name = "project-x")]
#[command(about = "Project X: Declarative Execution Protocol for AI Agents (Rust CLI)")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Validate {
        file: PathBuf,
    },
    Run {
        file: PathBuf,
        #[arg(long)]
        policy: Option<PathBuf>,
        #[arg(long, default_value_t = false)]
        allow_writes: bool,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long, default_value_t = false)]
        dry_run: bool,
    },
    Inspect {
        file: PathBuf,
    },
    Audit {
        trace: PathBuf,
        #[arg(long)]
        out_plan: Option<PathBuf>,
        #[arg(long)]
        out_report: Option<PathBuf>,
    },
    GenerateTrace {
        #[arg(long, default_value = "cloud-incident")]
        scenario: String,
        #[arg(long, default_value_t = 20)]
        scale: usize,
        #[arg(long, default_value = "openai")]
        format: String,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    Mcp {
        #[arg(long)]
        dir: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Validate { file } => {
            let content = match fs::read_to_string(&file) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error reading file '{:?}': {}", file, e);
                    std::process::exit(1);
                }
            };

            match parse_plan(&content) {
                Ok(parsed) => match build_dag(&parsed.plan) {
                    Ok(dag) => {
                        println!("✅ Plan is valid: {}", parsed.plan.metadata.name);
                        println!("   API Version: {}", parsed.plan.api_version);
                        println!("   Digest:      {}", parsed.digest);
                        println!(
                            "   Steps:       {} ({} execution wave[s])",
                            parsed.plan.spec.steps.len(),
                            dag.execution_waves.len()
                        );
                        println!("   Topological: {}", dag.topological_order.join(" -> "));
                    }
                    Err(e) => {
                        eprintln!("❌ DAG Validation error: {}", e);
                        std::process::exit(1);
                    }
                },
                Err(e) => {
                    eprintln!("❌ Parse error: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Commands::Run {
            file,
            policy,
            allow_writes,
            out,
            dry_run,
        } => {
            let content = match fs::read_to_string(&file) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error reading file '{:?}': {}", file, e);
                    std::process::exit(1);
                }
            };

            let runtime_policy = if let Some(policy_path) = policy {
                match fs::read_to_string(&policy_path) {
                    Ok(policy_content) => {
                        match serde_json::from_str::<RuntimePolicy>(&policy_content) {
                            Ok(p) => p,
                            Err(e) => {
                                eprintln!("Invalid policy JSON: {}", e);
                                std::process::exit(1);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("Could not read policy file: {}", e);
                        std::process::exit(1);
                    }
                }
            } else {
                RuntimePolicy {
                    allow_writes,
                    granted_permissions: Vec::new(),
                }
            };

            if dry_run {
                match parse_plan(&content) {
                    Ok(parsed) => {
                        let policy_engine = project_x_core::PolicyEngine::new(runtime_policy);
                        match policy_engine.validate_plan_pre_execution(&parsed.plan) {
                            Ok(decisions) => {
                                println!("✅ Pre-execution policy check passed (Dry Run)");
                                for d in decisions {
                                    println!("   - [{}] {}: {}", d.action, d.target, d.decision);
                                }
                                std::process::exit(0);
                            }
                            Err(e) => {
                                eprintln!("❌ Pre-execution policy check failed: {}", e);
                                std::process::exit(1);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("❌ Parse error: {}", e);
                        std::process::exit(1);
                    }
                }
            }

            let work_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            let mut adapter = project_x_core::ContainerToolAdapter::new(&work_dir);
            adapter.register_tool("echo", |args| Ok(serde_json::Value::Object(args.clone())));

            let options = ExecutionOptions {
                policy: runtime_policy,
                default_timeout_ms: 10000,
            };

            let interpreter = Interpreter::new(Arc::new(adapter), options);
            match interpreter.execute(&content).await {
                Ok(result) => {
                    println!("\n=== Execution Succeeded ===");
                    println!("Status:       {:?}", result.receipt.status);
                    println!("Execution ID: {}", result.receipt.execution_id);
                    println!("Duration:     {}ms", result.receipt.timestamps.duration_ms);

                    if let Some(out_path) = out {
                        let receipt_json = serde_json::to_string_pretty(&result.receipt).unwrap();
                        if let Err(e) = fs::write(&out_path, receipt_json) {
                            eprintln!("Failed to write output to '{:?}': {}", out_path, e);
                        } else {
                            println!("Receipt written to: {:?}", out_path);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("❌ Execution failed: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Commands::Inspect { file } => {
            let content = match fs::read_to_string(&file) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error reading file '{:?}': {}", file, e);
                    std::process::exit(1);
                }
            };

            match serde_json::from_str::<project_x_core::ExecutionReceipt>(&content) {
                Ok(receipt) => {
                    println!("\n=== Inspecting Receipt: {} ===", receipt.plan_id);
                    println!("Execution ID: {}", receipt.execution_id);
                    println!("Digest:       {}", receipt.plan_digest);
                    println!("Status:       {:?}", receipt.status);
                    println!("Duration:     {}ms", receipt.timestamps.duration_ms);
                    println!(
                        "Overhead:     {}ms",
                        receipt.metrics.interpreter_overhead_ms
                    );
                    println!(
                        "Total Bytes:  {} bytes",
                        receipt.metrics.total_bytes_processed
                    );
                    println!("\nSteps Execution Summary:");
                    for (id, rec) in &receipt.steps {
                        println!(
                            " - Step '{}': {:?} ({}ms, verified={:?})",
                            id, rec.status, rec.duration_ms, rec.verification
                        );
                    }
                }
                Err(e) => {
                    eprintln!("❌ Failed to parse receipt JSON: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Commands::Audit {
            trace,
            out_plan,
            out_report,
        } => {
            let content = match fs::read_to_string(&trace) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("Error reading trace file '{:?}': {}", trace, e);
                    std::process::exit(1);
                }
            };

            let val: serde_json::Value = match serde_json::from_str(&content) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("Invalid JSON in trace file: {}", e);
                    std::process::exit(1);
                }
            };

            match audit_trace(&val) {
                Ok(report) => {
                    println!("{}", report.markdown_summary);

                    if let Some(plan_path) = out_plan {
                        if let Err(e) = fs::write(&plan_path, &report.plan_yaml) {
                            eprintln!("Failed to write plan YAML: {}", e);
                        } else {
                            println!("Plan written to: {:?}", plan_path);
                        }
                    }

                    if let Some(report_path) = out_report {
                        if let Err(e) = fs::write(&report_path, &report.markdown_summary) {
                            eprintln!("Failed to write report: {}", e);
                        } else {
                            println!("Report written to: {:?}", report_path);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("❌ Audit failed: {}", e);
                    std::process::exit(1);
                }
            }
        }
        Commands::GenerateTrace {
            scenario,
            scale,
            format,
            out,
        } => {
            let config = project_x_core::TraceGeneratorConfig {
                scenario,
                scale,
                format,
            };
            let trace = project_x_core::generate_synthetic_trace(&config);
            let formatted =
                serde_json::to_string_pretty(&trace).unwrap_or_else(|_| "{}".to_string());
            if let Some(out_path) = out {
                if let Err(e) = fs::write(&out_path, &formatted) {
                    eprintln!("Failed to write trace to '{:?}': {}", out_path, e);
                    std::process::exit(1);
                }
                println!("Generated synthetic trace written to: {:?}", out_path);
            } else {
                println!("{}", formatted);
            }
        }
        Commands::Mcp { dir } => {
            use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

            let base_dir = dir
                .or_else(|| std::env::current_dir().ok())
                .unwrap_or_else(|| PathBuf::from("."));

            let stdin = tokio::io::stdin();
            let mut stdout = tokio::io::stdout();
            let mut reader = BufReader::new(stdin).lines();

            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let req: serde_json::Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                let id = req.get("id").cloned();
                let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");

                let response = match method {
                    "initialize" => {
                        serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "protocolVersion": "2024-11-05",
                                "serverInfo": {
                                    "name": "project-x",
                                    "version": "0.1.0"
                                },
                                "capabilities": {
                                    "tools": {}
                                }
                            }
                        })
                    }
                    "notifications/initialized" => continue,
                    "tools/list" => {
                        serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "tools": [
                                    {
                                        "name": "execute_plan",
                                        "description": "Execute a declarative multi-step execution plan (YAML or JSON) with AST policy validation and cryptographic receipts",
                                        "inputSchema": {
                                            "type": "object",
                                            "properties": {
                                                "plan": {
                                                    "type": "string",
                                                    "description": "ExecutionPlan YAML or JSON string"
                                                },
                                                "allow_writes": {
                                                    "type": "boolean",
                                                    "description": "Whether to authorize write operations"
                                                }
                                            },
                                            "required": ["plan"]
                                        }
                                    },
                                    {
                                        "name": "validate_plan",
                                        "description": "Validate an ExecutionPlan YAML or JSON string pre-flight without executing any steps",
                                        "inputSchema": {
                                            "type": "object",
                                            "properties": {
                                                "plan": {
                                                    "type": "string",
                                                    "description": "ExecutionPlan YAML or JSON string"
                                                }
                                            },
                                            "required": ["plan"]
                                        }
                                    },
                                    {
                                        "name": "inspect_receipt",
                                        "description": "Inspect and parse an ExecutionReceipt JSON string",
                                        "inputSchema": {
                                            "type": "object",
                                            "properties": {
                                                "receipt": {
                                                    "type": "string",
                                                    "description": "ExecutionReceipt JSON string"
                                                }
                                            },
                                            "required": ["receipt"]
                                        }
                                    }
                                ]
                            }
                        })
                    }
                    "tools/call" => {
                        let params = req.get("params").cloned().unwrap_or(serde_json::json!({}));
                        let tool_name = params.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        let tool_args = params
                            .get("arguments")
                            .cloned()
                            .unwrap_or(serde_json::json!({}));

                        let tool_output = match tool_name {
                            "validate_plan" => {
                                let plan_str =
                                    tool_args.get("plan").and_then(|v| v.as_str()).unwrap_or("");
                                match parse_plan(plan_str) {
                                    Ok(parsed) => match build_dag(&parsed.plan) {
                                        Ok(dag) => serde_json::json!({
                                            "valid": true,
                                            "plan_name": parsed.plan.metadata.name,
                                            "api_version": parsed.plan.api_version,
                                            "digest": parsed.digest,
                                            "steps_count": parsed.plan.spec.steps.len(),
                                            "waves_count": dag.execution_waves.len(),
                                            "topological": dag.topological_order
                                        }),
                                        Err(e) => {
                                            serde_json::json!({ "valid": false, "error": e.to_string() })
                                        }
                                    },
                                    Err(e) => {
                                        serde_json::json!({ "valid": false, "error": e.to_string() })
                                    }
                                }
                            }
                            "execute_plan" => {
                                let plan_str =
                                    tool_args.get("plan").and_then(|v| v.as_str()).unwrap_or("");
                                let allow_writes = tool_args
                                    .get("allow_writes")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);

                                let mut adapter =
                                    project_x_core::ContainerToolAdapter::new(&base_dir);
                                adapter.register_tool("echo", |args| {
                                    Ok(serde_json::Value::Object(args.clone()))
                                });

                                let options = ExecutionOptions {
                                    policy: RuntimePolicy {
                                        allow_writes,
                                        granted_permissions: Vec::new(),
                                    },
                                    default_timeout_ms: 15000,
                                };

                                let interpreter = Interpreter::new(Arc::new(adapter), options);
                                match interpreter.execute(plan_str).await {
                                    Ok(res) => serde_json::json!({
                                        "success": true,
                                        "status": format!("{:?}", res.receipt.status),
                                        "execution_id": res.receipt.execution_id,
                                        "receipt": res.receipt,
                                        "outputs": res.outputs
                                    }),
                                    Err(e) => {
                                        serde_json::json!({ "success": false, "error": e.to_string() })
                                    }
                                }
                            }
                            "inspect_receipt" => {
                                let receipt_str = tool_args
                                    .get("receipt")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                match serde_json::from_str::<project_x_core::ExecutionReceipt>(
                                    receipt_str,
                                ) {
                                    Ok(rcpt) => serde_json::json!({
                                        "valid": true,
                                        "status": format!("{:?}", rcpt.status),
                                        "plan_id": rcpt.plan_id,
                                        "execution_id": rcpt.execution_id,
                                        "duration_ms": rcpt.timestamps.duration_ms,
                                        "steps": rcpt.steps
                                    }),
                                    Err(e) => {
                                        serde_json::json!({ "valid": false, "error": e.to_string() })
                                    }
                                }
                            }
                            _ => {
                                serde_json::json!({ "error": format!("Unknown tool: {}", tool_name) })
                            }
                        };

                        serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "content": [
                                    {
                                        "type": "text",
                                        "text": serde_json::to_string_pretty(&tool_output).unwrap_or_default()
                                    }
                                ]
                            }
                        })
                    }
                    _ => {
                        serde_json::json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": {
                                "code": -32601,
                                "message": format!("Method not found: {}", method)
                            }
                        })
                    }
                };

                let resp_str = serde_json::to_string(&response).unwrap_or_default();
                let _ = stdout.write_all(resp_str.as_bytes()).await;
                let _ = stdout.write_all(b"\n").await;
                let _ = stdout.flush().await;
            }
        }
    }
}
