use serde_json::{Value, json};
use std::collections::HashSet;
use std::future::Future;

fn unsupported_rollback(error: &str) -> bool {
    let Some(raw) = error.strip_prefix("Request failed: ") else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<Value>(raw) else {
        return false;
    };
    let code = value["code"].as_i64();
    let message = value["message"].as_str().unwrap_or("");
    code == Some(-32601)
        || (code == Some(-32600)
            && message.contains("thread/rollback")
            && (message.contains("unknown variant") || message.contains("unknown method")))
}

async fn retained_turns<F, Fut>(
    thread_id: &str,
    mut cursor: Value,
    request: &mut F,
) -> Result<Vec<Value>, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let mut turns = Vec::new();
    let mut cursors = HashSet::new();
    loop {
        if let Some(cursor) = cursor.as_str()
            && !cursors.insert(cursor.to_owned())
        {
            return Err("Repeated Codex history cursor".into());
        }
        let page = request(
            "thread/turns/list",
            json!({
                "threadId":thread_id, "cursor":cursor, "limit":100,
                "sortDirection":"desc", "itemsView":"full",
            }),
        )
        .await?;
        let data = page["data"].as_array().ok_or("Invalid Codex turns page")?;
        turns.extend(data.iter().cloned());
        cursor = page
            .get("nextCursor")
            .cloned()
            .ok_or("Missing Codex history cursor")?;
        if cursor.is_null() {
            break;
        }
        if !cursor.is_string() {
            return Err("Invalid Codex history cursor".into());
        }
    }
    turns.reverse();
    Ok(turns)
}

pub(super) async fn rollback_thread<F, Fut>(params: Value, mut request: F) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let thread_id = params["threadId"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or("Invalid threadId")?;
    let num_turns = params["numTurns"]
        .as_u64()
        .filter(|n| *n > 0 && *n <= u32::MAX as u64)
        .ok_or("numTurns must be a positive integer")?;
    // Only unsupported methods trigger compatibility fallback; a busy or failed
    // rollback must never be retried as another history mutation.
    match request(
        "thread/rollback",
        json!({"threadId":thread_id,"numTurns":num_turns}),
    )
    .await
    {
        Ok(result) => return Ok(result),
        Err(error) if unsupported_rollback(&error) => {}
        Err(error) => return Err(error),
    }
    let before_turn_id = match params.get("beforeTurnId") {
        Some(Value::String(id)) if !id.is_empty() => id.clone(),
        None | Some(Value::Null) => {
            let turns = retained_turns(thread_id, Value::Null, &mut request).await?;
            let count = usize::try_from(num_turns).map_err(|_| "Invalid rollback count")?;
            let index = turns
                .len()
                .checked_sub(count)
                .ok_or("Rollback exceeds available turns")?;
            turns[index]["id"]
                .as_str()
                .ok_or("Missing Codex turn id")?
                .to_owned()
        }
        _ => return Err("Invalid beforeTurnId".into()),
    };
    let mut result = request(
        "thread/revert",
        json!({"threadId":thread_id,"beforeTurnId":before_turn_id}),
    )
    .await?;
    let cursor = result
        .get("turnsBackwardsCursor")
        .cloned()
        .ok_or("Missing reverted history cursor")?;
    let turns = if cursor.is_null() {
        Vec::new()
    } else {
        retained_turns(thread_id, cursor, &mut request)
            .await
            .map_err(|error| format!("对话历史已回滚，但重新加载失败，请重新打开会话：{error}"))?
    };
    let thread = result
        .get_mut("thread")
        .and_then(Value::as_object_mut)
        .ok_or("Invalid reverted thread")?;
    thread.insert("turns".into(), Value::Array(turns));
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::VecDeque;
    use std::future::ready;

    #[tokio::test]
    async fn falls_back_to_revert_and_hydrates_all_retained_turn_pages() {
        let mut replies = VecDeque::from([
            Err("Request failed: {\"code\":-32601,\"message\":\"Method not found\"}".to_owned()),
            Ok(json!({"thread":{"id":"thread","turns":[]},"turnsBackwardsCursor":"tail"})),
            Ok(json!({"data":[{"id":"b","items":[{"type":"userMessage"}]}],"nextCursor":"older"})),
            Ok(json!({"data":[{"id":"a","items":[]}],"nextCursor":null})),
        ]);
        let mut calls = Vec::new();
        let result = rollback_thread(
            json!({"threadId":"thread","numTurns":2,"beforeTurnId":"c"}),
            |method, params| {
                calls.push((method, params));
                ready(replies.pop_front().expect("unexpected request"))
            },
        )
        .await
        .unwrap();
        assert_eq!(
            calls[0],
            ("thread/rollback", json!({"threadId":"thread","numTurns":2}))
        );
        assert_eq!(
            calls[1],
            (
                "thread/revert",
                json!({"threadId":"thread","beforeTurnId":"c"})
            )
        );
        assert_eq!(calls[2].1["cursor"], "tail");
        assert_eq!(calls[2].1["itemsView"], "full");
        assert_eq!(calls[3].1["cursor"], "older");
        assert_eq!(result["thread"]["turns"][0]["id"], "a");
        assert_eq!(result["thread"]["turns"][1]["id"], "b");
        assert_eq!(
            result["thread"]["turns"][1]["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn old_codex_keeps_legacy_results_and_busy_errors_are_not_retried() {
        let payload = json!({"threadId":"t","numTurns":1,"beforeTurnId":"a"});
        let legacy = json!({"thread":{"id":"t","turns":[{"id":"kept","items":[]}]}});
        let result = rollback_thread(payload.clone(), |method, params| {
            assert_eq!(method, "thread/rollback");
            assert_eq!(params, json!({"threadId":"t","numTurns":1}));
            ready(Ok(legacy.clone()))
        })
        .await
        .unwrap();
        assert_eq!(result, legacy);
        let mut calls = 0;
        let result = rollback_thread(payload, |_, _| {
            calls += 1;
            ready(Err(
                "Request failed: {\"code\":-32000,\"message\":\"thread is busy\"}".to_owned(),
            ))
        })
        .await;
        assert!(result.unwrap_err().contains("busy"));
        assert_eq!(calls, 1);
    }

    #[tokio::test]
    async fn reverting_the_first_turn_returns_empty_history_without_fetching() {
        let mut replies = VecDeque::from([
            Err("Request failed: {\"code\":-32600,\"message\":\"unknown variant `thread/rollback`\"}".to_owned()),
            Ok(json!({"thread":{"id":"t","turns":[]},"turnsBackwardsCursor":null})),
        ]);
        let result = rollback_thread(
            json!({"threadId":"t","numTurns":1,"beforeTurnId":"a"}),
            |_, _| ready(replies.pop_front().unwrap()),
        )
        .await
        .unwrap();
        assert_eq!(result["thread"]["turns"], json!([]));
        assert!(replies.is_empty());
    }

    #[tokio::test]
    async fn invalid_rollback_counts_do_not_reach_codex() {
        for num_turns in [json!(0), json!(-1), json!(1.5), Value::Null] {
            let mut calls = 0;
            assert!(
                rollback_thread(json!({"threadId":"t","numTurns":num_turns}), |_, _| {
                    calls += 1;
                    ready(Ok(Value::Null))
                })
                .await
                .is_err()
            );
            assert_eq!(calls, 0);
        }
    }
}
