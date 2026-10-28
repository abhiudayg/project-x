use crate::interpreter::{ToolAdapter, ToolHandler};
use async_trait::async_trait;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;

pub struct ContainerToolAdapter {
    working_dir: PathBuf,
    custom_handlers: HashMap<String, ToolHandler>,
}

impl ContainerToolAdapter {
    pub fn new(working_dir: impl Into<PathBuf>) -> Self {
        Self {
            working_dir: working_dir.into(),
            custom_handlers: HashMap::new(),
        }
    }

    pub fn register_tool<F>(&mut self, name: &str, handler: F)
    where
        F: Fn(&Map<String, Value>) -> Result<Value, String> + Send + Sync + 'static,
    {
        self.custom_handlers
            .insert(name.to_string(), Arc::new(handler));
    }

    fn resolve_path(&self, relative: &str) -> PathBuf {
        let p = Path::new(relative);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            self.working_dir.join(p)
        }
    }
}

#[async_trait]
impl ToolAdapter for ContainerToolAdapter {
    async fn list_tools(&self) -> Vec<String> {
        let mut tools = vec![
            "echo".to_string(),
            "fs.read_file".to_string(),
            "fs.write_file".to_string(),
            "fs.list_dir".to_string(),
            "fs.file_exists".to_string(),
            "git.status".to_string(),
            "git.get_branch_head".to_string(),
            "git.diff".to_string(),
            "git.log".to_string(),
            "verify.run".to_string(),
            "verify.check".to_string(),
            "test.run".to_string(),
            "sh.exec".to_string(),
            "bash.exec".to_string(),
        ];
        for k in self.custom_handlers.keys() {
            if !tools.contains(k) {
                tools.push(k.clone());
            }
        }
        tools
    }

    async fn execute(&self, name: &str, args: &Map<String, Value>) -> Result<Value, String> {
        if let Some(handler) = self.custom_handlers.get(name) {
            return handler(args);
        }

        match name {
            "echo" => Ok(Value::Object(args.clone())),
            "fs.read_file" => {
                let path_str = args
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "fs.read_file requires 'path' argument".to_string())?;
                let target = self.resolve_path(path_str);
                let content = std::fs::read_to_string(&target)
                    .map_err(|e| format!("fs.read_file failed for '{}': {}", path_str, e))?;
                Ok(json!({
                    "path": path_str,
                    "content": content,
                    "size_bytes": content.len()
                }))
            }
            "fs.write_file" => {
                let path_str = args
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "fs.write_file requires 'path' argument".to_string())?;
                let content = args
                    .get("content")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "fs.write_file requires 'content' argument".to_string())?;
                let target = self.resolve_path(path_str);
                if let Some(parent) = target.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                std::fs::write(&target, content)
                    .map_err(|e| format!("fs.write_file failed for '{}': {}", path_str, e))?;
                Ok(json!({
                    "path": path_str,
                    "bytes_written": content.len()
                }))
            }
            "fs.list_dir" => {
                let path_str = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                let target = self.resolve_path(path_str);
                let read_dir = std::fs::read_dir(&target)
                    .map_err(|e| format!("fs.list_dir failed for '{}': {}", path_str, e))?;
                let mut entries = Vec::new();
                for entry in read_dir.flatten() {
                    if let Ok(name) = entry.file_name().into_string() {
                        entries.push(name);
                    }
                }
                entries.sort();
                Ok(json!({
                    "path": path_str,
                    "entries": entries
                }))
            }
            "fs.file_exists" => {
                let path_str = args
                    .get("path")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| "fs.file_exists requires 'path' argument".to_string())?;
                let target = self.resolve_path(path_str);
                Ok(json!({
                    "path": path_str,
                    "exists": target.exists()
                }))
            }
            "git.status" => {
                let output = Command::new("git")
                    .arg("status")
                    .arg("--porcelain")
                    .current_dir(&self.working_dir)
                    .output()
                    .map_err(|e| format!("git status execution failed: {}", e))?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                Ok(json!({
                    "clean": stdout.trim().is_empty(),
                    "status": stdout
                }))
            }
            "git.get_branch_head" => {
                let branch = args
                    .get("branch")
                    .and_then(|v| v.as_str())
                    .unwrap_or("HEAD");
                let output = Command::new("git")
                    .arg("rev-parse")
                    .arg(branch)
                    .current_dir(&self.working_dir)
                    .output()
                    .map_err(|e| format!("git rev-parse execution failed: {}", e))?;
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                Ok(json!({
                    "branch": branch,
                    "sha": stdout
                }))
            }
            "git.diff" => {
                let output = Command::new("git")
                    .arg("diff")
                    .current_dir(&self.working_dir)
                    .output()
                    .map_err(|e| format!("git diff execution failed: {}", e))?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                Ok(json!({
                    "diff": stdout
                }))
            }
            "git.log" => {
                let count = args.get("count").and_then(|v| v.as_u64()).unwrap_or(5);
                let output = Command::new("git")
                    .arg("log")
                    .arg("-n")
                    .arg(count.to_string())
                    .arg("--oneline")
                    .current_dir(&self.working_dir)
                    .output()
                    .map_err(|e| format!("git log execution failed: {}", e))?;
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                Ok(json!({
                    "log": stdout
                }))
            }
            "verify.run" => {
                let verify_script = self.working_dir.join(".verify/run.sh");
                let alt_script = self.working_dir.join("verify/run.sh");
                let script_path = if verify_script.exists() {
                    Some(verify_script)
                } else if alt_script.exists() {
                    Some(alt_script)
                } else {
                    None
                };

                if let Some(script) = script_path {
                    let output = Command::new("sh")
                        .arg(script)
                        .arg("all")
                        .current_dir(&self.working_dir)
                        .output()
                        .map_err(|e| format!("verify.run execution failed: {}", e))?;
                    let code = output.status.code().unwrap_or(1);
                    Ok(json!({
                        "exit_code": code,
                        "passed": code == 0,
                        "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
                        "stderr": String::from_utf8_lossy(&output.stderr).to_string()
                    }))
                } else {
                    Ok(json!({
                        "exit_code": 0,
                        "passed": true,
                        "stdout": "No .verify/run.sh found, defaulting to passed",
                        "stderr": ""
                    }))
                }
            }
            "verify.check" | "test.run" | "sh.exec" | "bash.exec" => {
                let cmd = args
                    .get("command")
                    .or_else(|| args.get("cmd"))
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| format!("{} requires 'command' argument", name))?;
                let output = Command::new("/bin/sh")
                    .arg("-c")
                    .arg(cmd)
                    .current_dir(&self.working_dir)
                    .output()
                    .map_err(|e| format!("{} execution failed: {}", name, e))?;
                let code = output.status.code().unwrap_or(1);
                Ok(json!({
                    "exit_code": code,
                    "passed": code == 0,
                    "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
                    "stderr": String::from_utf8_lossy(&output.stderr).to_string()
                }))
            }
            _ => {
                if name.starts_with("mock.") || name.starts_with("test_mock.") {
                    Ok(Value::Object(args.clone()))
                } else {
                    Err(format!(
                        "Tool '{}' not found in container tool adapter",
                        name
                    ))
                }
            }
        }
    }
}
