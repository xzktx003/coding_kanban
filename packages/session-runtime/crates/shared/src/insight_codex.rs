// Adapted from agent-insights d653ec5, Copyright (c) 2025 milisp (MIT).
// License retained in packages/session-runtime/LICENSE.
use agent_insights::domain::{AgentRecord, AgentType, TokenInfo};
use agent_insights::scanner::{FileInfo, FileScanner};
use anyhow::Result;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

static RECORDS: OnceLock<Mutex<HashMap<PathBuf, (FileInfo, AgentRecord)>>> = OnceLock::new();

pub(crate) struct StreamingCodexScanner {
    scanner: FileScanner,
}

impl StreamingCodexScanner {
    pub fn new(root: PathBuf) -> Self {
        Self {
            scanner: FileScanner::new(root),
        }
    }

    pub fn scan(&self) -> Result<Vec<AgentRecord>> {
        let jsonl_files = self.scanner.scan_jsonl_files()?;
        let mut cached = RECORDS.get_or_init(|| Mutex::new(HashMap::new())).lock()
            .map_err(|_| anyhow::anyhow!("Usage record cache is unavailable"))?;
        let present: HashSet<_> = jsonl_files.iter().map(|info| info.path.clone()).collect();
        cached.retain(|path, _| !path.starts_with(&self.scanner.root) || present.contains(path));
        let mut records = Vec::new();

        for file_info in jsonl_files.iter() {
            if let Some((previous, record)) = cached.get(&file_info.path)
                && previous.size == file_info.size && previous.modified_at == file_info.modified_at
                && previous.created_at == file_info.created_at
            {
                records.push(record.clone());
                continue;
            }
            if let Ok(record) = self.parse_jsonl_file(file_info) {
                cached.insert(file_info.path.clone(), (file_info.clone(), record.clone()));
                records.push(record);
            }
        }

        Ok(records)
    }

    fn parse_jsonl_file(&self, file_info: &FileInfo) -> Result<AgentRecord> {
        let reader = BufReader::new(fs::File::open(&file_info.path)?);

        let mut session_id: Option<String> = None;
        let mut model: Option<String> = None;
        let mut cwd: Option<String> = None;
        let mut total_input = 0u64;
        let mut total_cached_input = 0u64;
        let mut total_output = 0u64;
        let mut total_reasoning = 0u64;
        let mut total_tokens = 0u64;
        let mut tool_calls: Vec<String> = Vec::new();

        let mut first_line = true;
        for line in reader.lines() {
            let line = line?;
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            // Agent output and images dominate large histories but contribute
            // nothing to usage. Escaped JSON tags retain the full-parser fallback.
            if !first_line && !line.contains("\\u") && ![
                "\"session_meta\"", "\"turn_context\"", "\"token_count\"", "\"custom_tool_call\""
            ].iter().any(|tag| line.contains(tag)) { continue; }

            let Ok(json) = serde_json::from_str::<Value>(line) else { continue };
            if first_line {
                first_line = false;
                cwd = json.pointer("/payload/cwd").and_then(Value::as_str).map(str::to_string);
            }
            let Some(payload) = json.get("payload") else { continue };
            match json.get("type").and_then(Value::as_str) {
                Some("event_msg") if payload.get("type").and_then(Value::as_str) == Some("token_count") => {
                    if let Some(usage) = payload.pointer("/info/total_token_usage") {
                        for (key, target) in [
                            ("input_tokens", &mut total_input),
                            ("cached_input_tokens", &mut total_cached_input),
                            ("output_tokens", &mut total_output),
                            ("reasoning_output_tokens", &mut total_reasoning),
                            ("total_tokens", &mut total_tokens),
                        ] {
                            if let Some(value) = usage.get(key).and_then(Value::as_u64) { *target = value; }
                        }
                    }
                }
                Some("response_item") if payload.get("type").and_then(Value::as_str) == Some("custom_tool_call") => {
                    if let Some(name) = payload.get("name").and_then(Value::as_str) { tool_calls.push(name.to_string()); }
                }
                Some("session_meta") if session_id.is_none() => {
                    session_id = payload.get("id").and_then(Value::as_str).map(str::to_string);
                }
                Some("turn_context") if model.is_none() => {
                    model = payload.get("model").and_then(Value::as_str).map(str::to_string);
                }
                _ => {}
            }
        }

        let tokens = if total_input > 0 || total_output > 0 {
            Some(TokenInfo {
                input: total_input,
                output: total_output,
                cached: total_cached_input,
                cache_creation: 0,
                reasoning: total_reasoning,
                total: total_tokens,
            })
        } else {
            None
        };

        Ok(AgentRecord {
            agent_type: AgentType::Codex,
            file_path: file_info.path.to_string_lossy().to_string(),
            created_at: file_info.created_at,
            modified_at: file_info.modified_at,
            file_size: file_info.size,
            session_id,
            model,
            cwd,
            tokens,
            tool_calls,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn token_and_tool_statistics_match_the_pinned_upstream_scanner() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join(".codex");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("session.jsonl"), concat!(
            "{\"type\":\"session_meta\",\"payload\":{\"cwd\":\"/project\",\"id\":\"fixture\"}}\n",
            "{\"type\":\"turn_context\",\"payload\":{\"model\":\"first-model\"}}\n",
            "{\"type\":\"turn_context\",\"payload\":{\"model\":\"later-model\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":10,\"cached_input_tokens\":2,\"output_tokens\":3,\"reasoning_output_tokens\":1,\"total_tokens\":13}}}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"custom_tool_call\",\"name\":\"exec_command\"}}\n",
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":20,\"cached_input_tokens\":4,\"output_tokens\":7,\"reasoning_output_tokens\":2,\"total_tokens\":27}}}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"custom_tool_call\",\"name\":\"apply_patch\"}}\n",
            "{\"type\":\"response_item\",\"payload\":{\"type\":\"function_call_output\",\"output\":\"irrelevant content\"}}\n",
            "malformed trailing record\n"
        )).unwrap();
        let old = agent_insights::agents::CodexScanner::new(temp.path().to_str().unwrap()).scan().unwrap();
        let new = StreamingCodexScanner::new(root).scan().unwrap();
        assert_eq!(serde_json::to_value(old).unwrap(), serde_json::to_value(new).unwrap());
    }

    #[test]
    fn appended_usage_and_deleted_files_refresh_the_record_cache() {
        use std::io::Write;
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("session.jsonl");
        fs::write(&path, "{\"type\":\"session_meta\",\"payload\":{\"id\":\"fixture\",\"cwd\":\"/project\"}}\n").unwrap();
        let scanner = StreamingCodexScanner::new(temp.path().to_path_buf());
        assert!(scanner.scan().unwrap()[0].tokens.is_none());
        let mut file = fs::OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(concat!(r#"{"type":"event_msg","payload":{"type":"\u0074oken_count","info":{"total_token_usage":{"input_tokens":9,"output_tokens":2,"total_tokens":11}}}}"#, "\n").as_bytes()).unwrap();
        file.flush().unwrap();
        assert_eq!(scanner.scan().unwrap()[0].tokens.as_ref().unwrap().total, 11);
        fs::remove_file(path).unwrap();
        assert!(scanner.scan().unwrap().is_empty());
    }
}
