use clap::{Parser, Subcommand};
use project_x_core::{
    audit_trace, build_dag, parse_plan, ExecutionOptions, InMemoryToolAdapter, Interpreter,
    RuntimePolicy,
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

            let mut adapter = InMemoryToolAdapter::new();
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
    }
}
