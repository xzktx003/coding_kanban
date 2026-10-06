use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use chrono::{DateTime, Utc};
use serde_json::Value;

pub fn parse_json_line(line: &str) -> Option<Value> {
    serde_json::from_str(line).ok()
}

pub fn extract_preview(value: &Value) -> Option<String> {
    let payload = value.get("payload")?;
    if let Some(content) = payload.get("content").and_then(|v| v.as_array()) {
        for item in content {
            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty()
                    && !trimmed.starts_with('<')
                    && !trimmed.contains("<INSTRUCTIONS>")
                {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    payload.get("text").and_then(|v| v.as_str()).and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() || trimmed.starts_with('<') || trimmed.contains("<INSTRUCTIONS>") {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn parse_ts(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.with_timezone(&Utc).timestamp())
}

pub fn file_mtime(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_secs() as i64)
}

pub fn file_created_time(path: &Path) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let created = metadata.created().ok()?;
    let duration = created.duration_since(UNIX_EPOCH).ok()?;
    Some(duration.as_secs() as i64)
}

pub fn codex_home() -> PathBuf {
    if let Some(path) = std::env::var_os("CODEX_HOME") {
        return PathBuf::from(path);
    }

    dirs::home_dir()
        .map(|home| home.join(".codex"))
        .unwrap_or_else(|| PathBuf::from(".codex"))
}

pub fn codexia_history_path() -> PathBuf {
    Some(session_data_home())
        .map(|home| home.join(".codexia").join("history.jsonl"))
        .unwrap_or_else(|| PathBuf::from(".codexia/history.jsonl"))
}

/// Application data is isolated without changing native CLI account locations.
fn session_data_home() -> std::path::PathBuf {
    std::env::var_os("SESSION_DATA_HOME").map(std::path::PathBuf::from)
        .or_else(dirs::home_dir).expect("application data home must be configured")
}
