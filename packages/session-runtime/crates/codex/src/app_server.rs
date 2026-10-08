use super::server_request::handle_server_request;
use crate::protocol::{RequestId, ServerMessage, classify};
use codexia_db::automation_runs::sync_automation_run_status;
use codexia_shared::event_sink::EventSink;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{Mutex, oneshot};

use codex_finder::discover_codex_command;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Reasoning traffic is dropped before it reaches the frontend.
fn is_reasoning_notification(method: &str, raw: &Value) -> bool {
    match method {
        "item/reasoning/textDelta"
        | "item/reasoning/summaryTextDelta"
        | "item/reasoning/summaryPartAdded" => true,
        "item/started" | "item/completed" => {
            raw.pointer("/params/item/type").and_then(Value::as_str) == Some("reasoning")
        }
        _ => false,
    }
}

pub struct CodexAppServer {
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next_id: AtomicU64,
    pub ownership: crate::ownership::Ownership,
}

impl CodexAppServer {
    async fn write_message(&self, value: Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().await;
        let mut line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        line.push('\n');
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.ownership.call(self, method, params).await
    }

    async fn raw_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);

        if let Err(error) = self
            .write_message(serde_json::json!({
                "id": id,
                "method": method,
                "params": params
            }))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(format!("DELIVERY_UNKNOWN: {error}"));
        }

        match tokio::time::timeout(std::time::Duration::from_secs(30), rx).await {
            Ok(Ok(result)) => result,
            _ => {
                self.pending.lock().await.remove(&id);
                Err("DELIVERY_UNKNOWN: Codex response unavailable".into())
            }
        }
    }

    pub async fn send_response(&self, id: RequestId, result: Value) -> Result<(), String> {
        let key = serde_json::to_value(&id)
            .map_err(|e| e.to_string())?
            .to_string();
        self.write_message(serde_json::json!({ "id": id, "result": result }))
            .await?;
        self.ownership.resolve_request(&key);
        Ok(())
    }

    pub async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let value = if let Some(params) = params {
            serde_json::json!({ "method": method, "params": params })
        } else {
            serde_json::json!({ "method": method })
        };
        self.write_message(value).await
    }
}

#[async_trait::async_trait]
impl crate::ownership::Rpc for CodexAppServer {
    async fn raw(&self, method: &str, params: Value) -> Result<Value, String> {
        self.raw_request(method, params).await
    }
}

#[derive(Clone)]
pub struct AppState {
    pub codex: Arc<CodexAppServer>,
}

pub struct CodexInitializationState {
    pub event_sink: Arc<dyn EventSink>,
    pub initialized: std::sync::atomic::AtomicBool,
    pub init_lock: Mutex<()>,
}

impl CodexInitializationState {
    pub fn new(event_sink: Arc<dyn EventSink>) -> Self {
        Self {
            event_sink,
            initialized: std::sync::atomic::AtomicBool::new(false),
            init_lock: Mutex::new(()),
        }
    }
}

pub async fn connect_codex(event_sink: Arc<dyn EventSink>) -> Result<Arc<CodexAppServer>, String> {
    log::info!("Connecting to codex app-server");
    let codex_bin =
        discover_codex_command().ok_or_else(|| "Unable to locate codex binary".to_string())?;

    let mut command = {
        let mut cmd = Command::new(codex_bin);
        cmd.args(["app-server", "-c", "thread_unload_delay_secs=2"]);
        cmd
    };

    // A GUI launch inherits none of the login shell's exports, so providers
    // configured with `env_key` would see a missing variable. Resolve them the
    // same way the settings UI does and pass them to the child.
    for (key, value) in crate::env::get_envs(&crate::env::provider_env_keys()) {
        command.env(key, value);
    }

    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("missing stdin")?;
    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;

    let client = Arc::new(CodexAppServer {
        stdin: Mutex::new(stdin),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        ownership: crate::ownership::Ownership::default(),
    });
    log::info!("Connected to codex app-server");

    // Spawn stdout reader task
    let client_clone = Arc::clone(&client);
    let event_sink_clone = Arc::clone(&event_sink);
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            let value: Value = match serde_json::from_str(&line) {
                Ok(v) => v,
                Err(err) => {
                    log::warn!("codex:parseError: {:?}", err);
                    event_sink_clone.emit(
                        "codex:parseError",
                        serde_json::json!({ "error": err.to_string(), "raw": line }),
                    );
                    continue;
                }
            };

            // Classify message type
            match classify(&value) {
                Some(ServerMessage::Response { id, result }) => {
                    let Some(id) = id.as_pending_key() else {
                        continue;
                    };
                    if let Some(tx) = client_clone.pending.lock().await.remove(&id) {
                        let _ = tx.send(Ok(result));
                    }
                }
                Some(ServerMessage::Error { id, error }) => {
                    let Some(id) = id.as_pending_key() else {
                        continue;
                    };
                    if let Some(tx) = client_clone.pending.lock().await.remove(&id) {
                        let _ = tx.send(Err(format!("Request failed: {}", error)));
                    }
                }
                Some(ServerMessage::Request { id, method, params }) => {
                    if let Some(thread) = params.get("threadId").and_then(Value::as_str)
                        && let Ok(request) = serde_json::to_value(&id)
                    {
                        client_clone
                            .ownership
                            .pending_request(request.to_string(), thread.into());
                    }
                    handle_server_request(&event_sink_clone, id, &method, params).await;
                }
                Some(ServerMessage::Notification { method, raw }) => {
                    if is_reasoning_notification(&method, &raw) {
                        continue;
                    }
                    client_clone.ownership.observe(&method, &raw["params"]);
                    sync_automation_run_status(&raw);
                    event_sink_clone.emit("codex:notification", raw);
                }
                None => {}
            }
        }
    });

    // Reclaim only sessions this client acquired. Browser lifetime is irrelevant.
    let weak = Arc::downgrade(&client);
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            let Some(client) = weak.upgrade() else { break };
            for id in client.ownership.ids() {
                client.ownership.sweep(client.as_ref(), &id).await;
            }
        }
    });

    // Spawn stderr reader task
    let event_sink_clone = Arc::clone(&event_sink);
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            log::warn!("codex:stderr: {}", line);
            event_sink_clone.emit("codex:stderr", serde_json::json!({ "message": line }));
        }
    });

    Ok(client)
}

pub async fn initialize_codex(
    codex: &CodexAppServer,
    event_sink: Arc<dyn EventSink>,
) -> Result<(), String> {
    log::info!("Initializing codex app-server session");
    let params_value = serde_json::json!({
        "clientInfo": {
            "name": "codexia",
            "title": "Codexia",
            "version": env!("CARGO_PKG_VERSION"),
        },
        "capabilities": {
            "experimentalApi": true,
            "requestAttestation": false,
            "mcpServerOpenaiFormElicitation": false,
            "optOutNotificationMethods": null,
        },
    });

    let response = codex.send_request("initialize", params_value).await?;
    log::info!(
        "Codex initialized successfully, userAgent: {}",
        response
            .get("userAgent")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
    );

    if let Err(err) = codex.send_notification("initialized", None).await {
        log::error!("Failed to send initialized notification: {}", err);
    }

    event_sink.emit("codex:initialized", response);

    Ok(())
}
