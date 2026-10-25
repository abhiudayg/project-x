use serde_json::{Map, Value};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ResolutionError {
    #[error("Step '{0}' output is not available")]
    StepOutputMissing(String),
    #[error("Path '{0}' not found in step '{1}' output")]
    PathNotFound(String, String),
    #[error("Invalid path format: {0}")]
    InvalidPath(String),
}

pub fn extract_path(root: &Value, path: &str) -> Result<Value, ResolutionError> {
    if path.is_empty() || path == "result" || path == "$" {
        return Ok(root.clone());
    }

    let normalized = path.replace('[', ".").replace(']', "");
    let segments: Vec<&str> = normalized.split('.').filter(|s| !s.is_empty()).collect();

    let mut current = root;

    for segment in segments {
        if let Ok(index) = segment.parse::<usize>() {
            match current {
                Value::Array(arr) => {
                    if let Some(item) = arr.get(index) {
                        current = item;
                    } else {
                        return Err(ResolutionError::PathNotFound(
                            path.to_string(),
                            segment.to_string(),
                        ));
                    }
                }
                _ => {
                    return Err(ResolutionError::PathNotFound(
                        path.to_string(),
                        segment.to_string(),
                    ));
                }
            }
        } else {
            match current {
                Value::Object(map) => {
                    if let Some(val) = map.get(segment) {
                        current = val;
                    } else {
                        return Err(ResolutionError::PathNotFound(
                            path.to_string(),
                            segment.to_string(),
                        ));
                    }
                }
                _ => {
                    return Err(ResolutionError::PathNotFound(
                        path.to_string(),
                        segment.to_string(),
                    ));
                }
            }
        }
    }

    Ok(current.clone())
}

pub fn resolve_value(
    val: &Value,
    step_outputs: &HashMap<String, Value>,
) -> Result<Value, ResolutionError> {
    match val {
        Value::Object(map) => {
            if map.len() == 2 && map.contains_key("from") && map.contains_key("path") {
                let from = map["from"].as_str().unwrap_or("");
                let path = map["path"].as_str().unwrap_or("");
                if !from.is_empty() {
                    let output = step_outputs
                        .get(from)
                        .ok_or_else(|| ResolutionError::StepOutputMissing(from.to_string()))?;
                    return extract_path(output, path);
                }
            }

            let mut resolved_map = Map::new();
            for (k, v) in map {
                resolved_map.insert(k.clone(), resolve_value(v, step_outputs)?);
            }
            Ok(Value::Object(resolved_map))
        }
        Value::Array(arr) => {
            let mut resolved_arr = Vec::with_capacity(arr.len());
            for item in arr {
                resolved_arr.push(resolve_value(item, step_outputs)?);
            }
            Ok(Value::Array(resolved_arr))
        }
        Value::String(s) => {
            if s.starts_with("$steps.") {
                let parts: Vec<&str> = s.splitn(4, '.').collect();
                if parts.len() >= 3 && parts[2] == "output" {
                    let step_id = parts[1];
                    let path = if parts.len() == 4 { parts[3] } else { "" };
                    let output = step_outputs
                        .get(step_id)
                        .ok_or_else(|| ResolutionError::StepOutputMissing(step_id.to_string()))?;
                    return extract_path(output, path);
                }
            }
            Ok(Value::String(s.clone()))
        }
        _ => Ok(val.clone()),
    }
}

pub fn resolve_arguments(
    raw_args: &Map<String, Value>,
    step_outputs: &HashMap<String, Value>,
) -> Result<Map<String, Value>, ResolutionError> {
    let mut resolved = Map::new();
    for (k, v) in raw_args {
        resolved.insert(k.clone(), resolve_value(v, step_outputs)?);
    }
    Ok(resolved)
}
