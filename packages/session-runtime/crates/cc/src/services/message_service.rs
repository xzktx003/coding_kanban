use crate::state::CCState;
use claude_agent_sdk_rs::{Message, UserContentBlock};
use futures::StreamExt;

fn image_path_to_content_block(path: &str) -> Result<UserContentBlock, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("Failed to read image {path}: {e}"))?;
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/png",
    };
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes);
    UserContentBlock::image_base64(mime, &b64).map_err(|e| e.to_string())
}

pub(crate) async fn send_message_and_wait(
    session_id: &str,
    message: &str,
    image_paths: &[String],
    state: &CCState,
    mut message_callback: impl FnMut(Message) + Send,
) -> Result<(), String> {
    let client = state
        .get_client(session_id)
        .await
        .ok_or("Client not found")?;

    {
        let mut client = client.write().await;
        let timeout = std::env::var("SESSION_CLAUDE_CONNECT_TIMEOUT_MS").ok().and_then(|value| value.parse::<u64>().ok()).filter(|value| (1000..=300_000).contains(value)).unwrap_or(60_000);
        tokio::time::timeout(std::time::Duration::from_millis(timeout), client.connect()).await.map_err(|_| "Claude 启动连接超时，请检查 CLI 模型和服务配置后重新建立会话".to_string())?.map_err(|e| e.to_string())?;
    }

    if image_paths.is_empty() {
        let mut client = client.write().await;
        client.query_with_session(message, session_id).await.map_err(|e| e.to_string())?;
    } else {
        let mut content: Vec<UserContentBlock> = Vec::new();
        if !message.is_empty() {
            content.push(UserContentBlock::text(message));
        }
        for path in image_paths {
            content.push(image_path_to_content_block(path)?);
        }
        if content.is_empty() {
            content.push(UserContentBlock::text(""));
        }
        let mut client = client.write().await;
        client.query_with_content_and_session(content, session_id).await.map_err(|e| e.to_string())?;
    }

    loop {
        let result = {
            // Use a read lock so interrupt() can acquire a concurrent read lock
            let client = client.read().await;
            let mut stream = client.receive_response();
            stream.next().await
        };

        match result {
            Some(Ok(msg)) => {
                message_callback(msg.clone());
                if matches!(msg, Message::Result(_)) {
                    break;
                }
            }
            Some(Err(e)) => return Err(e.to_string()),
            None => return Err("Claude response stream closed before completion".into()),
        }
    }

    Ok(())
}

pub async fn send_message(
    session_id: &str,
    message: &str,
    image_paths: &[String],
    state: &CCState,
    message_callback: impl Fn(Message) + Send + 'static,
) -> Result<(), String> {
    if state.get_client(session_id).await.is_none() {
        return Err("Client not found".to_string());
    }

    let session_id_owned = session_id.to_string();
    let message_owned = message.to_string();
    let image_paths_owned = image_paths.to_vec();
    let state_cloned = state.clone();

    let (handle, registration) = futures::future::AbortHandle::new_pair();
    match state.active_messages.entry(session_id_owned.clone()) {
        dashmap::mapref::entry::Entry::Occupied(_) => return Err("A message is already running in this Claude session".into()),
        dashmap::mapref::entry::Entry::Vacant(entry) => { entry.insert(handle); }
    }
    tokio::spawn(async move {
        let result = futures::future::Abortable::new(send_message_and_wait(
            &session_id_owned, &message_owned, &image_paths_owned, &state_cloned, message_callback,
        ), registration).await;
        let was_aborted = result.is_err();
        match result {
            Ok(Err(error)) => emit_failure(&state_cloned, &session_id_owned, &error),
            Err(_) => state_cloned.emit("cc-message", serde_json::json!({"type": "result", "subtype": "interrupted", "is_error": false, "session_id": session_id_owned, "result": "当前消息已中断", "duration_ms": 0, "duration_api_ms": 0, "num_turns": 0})),
            Ok(Ok(())) => {},
        }
        // An aborted task can finish after another request started. Remove only
        // its own registration, never that newer request's cancellation handle.
        state_cloned.active_messages.remove_if(&session_id_owned, |_, current| current.is_aborted() || !was_aborted);
    });

    Ok(())
}

fn emit_failure(state: &CCState, session_id: &str, message: &str) {
    state.emit("cc-message", serde_json::json!({
        "type": "result", "subtype": "error_during_execution", "is_error": true,
        "session_id": session_id, "result": message, "duration_ms": 0,
        "duration_api_ms": 0, "num_turns": 0
    }));
}

#[cfg(test)]
mod browser_failure_tests {
    use super::*;
    use serde_json::Value;
    use std::sync::{Arc, Mutex};
    #[derive(Default)] struct Capture(Mutex<Vec<(String, Value)>>);
    impl codexia_shared::event_sink::EventSink for Capture {
        fn emit(&self, name: &str, value: Value) { self.0.lock().unwrap().push((name.into(), value)); }
    }
    #[test]
    fn background_errors_finish_the_browser_loading_state() {
        let capture = Arc::new(Capture::default()); let state = CCState::new(capture.clone());
        emit_failure(&state, "browser-session", "Connection lost");
        let events = capture.0.lock().unwrap();
        assert_eq!(events[0].0, "cc-message");
        assert_eq!(events[0].1["type"], "result");
        assert_eq!(events[0].1["session_id"], "browser-session");
        assert_eq!(events[0].1["is_error"], true);
    }
}
