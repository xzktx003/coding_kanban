//! Execution ownership is independent of reading history or keeping a tab open.
use async_trait::async_trait;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex as SyncMutex};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

// async-trait adds a redundant must_use to its generated boxed future.
#[allow(clippy::double_must_use)]
#[async_trait]
pub trait Rpc: Send + Sync {
    async fn raw(&self, method: &str, params: Value) -> Result<Value, String>;
}

#[derive(Default)]
pub struct Ownership {
    entries: SyncMutex<HashMap<String, Arc<Mutex<Entry>>>>,
    signals: SyncMutex<Signals>,
}
#[derive(Default)]
struct Signals {
    revision: u64,
    queue_sequence: u128,
    pending: HashMap<String, String>,
    queue: Option<(Instant, bool, HashSet<String>)>,
}
struct Entry {
    state: &'static str,
    reason: String,
    generation: u64,
    uncertain: bool,
    releasing_since: Option<Instant>,
}
impl Default for Entry {
    fn default() -> Self {
        Self {
            state: "readonly",
            reason: String::new(),
            generation: 0,
            uncertain: false,
            releasing_since: None,
        }
    }
}
fn mutation(method: &str) -> bool {
    matches!(
        method,
        "turn/start"
            | "turn/steer"
            | "turn/interrupt"
            | "review/start"
            | "thread/resume"
            | "thread/rollback"
            | "thread/revert"
            | "thread/compact/start"
            | "thread/goal/set"
            | "thread/goal/clear"
            | "thread/settings/update"
            | "thread/name/set"
            | "thread/archive"
            | "thread/delete"
            | "thread/shellCommand"
            | "thread/inject_items"
            | "thread/metadata/update"
            | "thread/memoryMode/set"
    )
}
fn direct_input(method: &str) -> bool {
    matches!(method, "turn/start" | "turn/steer" | "review/start" | "thread/rollback" | "thread/revert" | "thread/goal/set" | "thread/goal/clear" | "thread/settings/update")
}
fn child_input_allowed(thread: &Value) -> bool {
    let child = thread["parentThreadId"].is_string()
        || thread.pointer("/source/subAgent/thread_spawn/parent_thread_id").is_some()
        || thread.pointer("/source/subAgent/threadSpawn/parentThreadId").is_some()
        || thread.pointer("/source/subagent/thread_spawn/parent_thread_id").is_some();
    !child || thread["canAcceptDirectInput"].as_bool() == Some(true)
}
fn writer_conflict(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("active writer")
        || lower.contains("already being used")
        || lower.contains("writer lock")
}
impl Ownership {
    fn entry(&self, id: &str) -> Arc<Mutex<Entry>> {
        self.entries
            .lock()
            .unwrap()
            .entry(id.into())
            .or_default()
            .clone()
    }
    pub fn ids(&self) -> Vec<String> {
        self.entries.lock().unwrap().keys().cloned().collect()
    }
    /// The gateway uses the host monotonic clock, which survives gateway restarts.
    /// Late HTTP requests must not replace a newer outbox snapshot.
    pub fn queue_update_ordered(&self, sequence: u128, busy: bool, ids: Vec<String>) -> bool {
        let mut signals = self.signals.lock().unwrap();
        if sequence <= signals.queue_sequence {
            return false;
        }
        signals.queue_sequence = sequence;
        signals.revision += 1;
        signals.queue = Some((Instant::now(), busy, ids.into_iter().collect()));
        true
    }
    #[cfg(test)]
    pub fn queue_update(&self, busy: bool, ids: Vec<String>) {
        let mut signals = self.signals.lock().unwrap();
        signals.revision += 1;
        signals.queue = Some((Instant::now(), busy, ids.into_iter().collect()));
    }
    pub fn pending_request(&self, request: String, thread: String) {
        let mut signals = self.signals.lock().unwrap();
        signals.revision += 1;
        signals.pending.insert(request, thread);
    }
    pub fn resolve_request(&self, request: &str) {
        let mut signals = self.signals.lock().unwrap();
        signals.revision += 1;
        signals.pending.remove(request);
    }
    pub fn observe(&self, method: &str, params: &Value) {
        if method == "serverRequest/resolved"
            && let Some(id) = params.get("requestId")
        {
            self.resolve_request(&id.to_string());
        }
        if params.get("threadId").is_some() || params.get("thread").is_some() {
            self.signals.lock().unwrap().revision += 1;
        }
    }
    pub async fn access(&self, id: &str) -> Value {
        let entry = self.entry(id);
        let entry = entry.lock().await;
        json!({"state":entry.state,"reason":entry.reason,"generation":entry.generation})
    }
    fn hold(&self, id: &str) -> Option<String> {
        let signals = self.signals.lock().unwrap();
        match &signals.queue {
            Some((when, busy, ids)) if when.elapsed() < Duration::from_secs(10) => {
                if *busy || ids.contains(id) {
                    return Some("队列正在执行或有待确认的发送".into());
                }
            }
            _ => return Some("等待网关确认队列状态".into()),
        }
        if signals.pending.values().any(|thread| thread == id) {
            return Some("等待审批或回答".into());
        }
        None
    }
    pub async fn call(&self, rpc: &impl Rpc, method: &str, params: Value) -> Result<Value, String> {
        if method == "thread/unsubscribe" {
            let id = params["threadId"].as_str().ok_or("threadId required")?;
            return self.release(rpc, id).await;
        }
        let id = params.get("threadId").and_then(Value::as_str);
        if !mutation(method) || id.is_none() {
            let result = rpc.raw(method, params).await?;
            // Newly created/forked threads are loaded without a preceding resume.
            if matches!(method, "thread/start" | "thread/fork")
                && let Some(id) = result.pointer("/thread/id").and_then(Value::as_str)
            {
                self.entry(id).lock().await.state = "owned";
            }
            return Ok(result);
        }
        let id = id.unwrap().to_owned();
        if direct_input(method) {
            // Check before acquiring: an inspection must not become a writer just
            // to discover that native V2 forbids app-server input to this child.
            let metadata = rpc.raw("thread/read", json!({"threadId":id,"includeTurns":false})).await
                .map_err(|error| format!("SESSION_ACQUIRE_FAILED: 尚未发送，无法确认输入权限：{error}"))?;
            if metadata.pointer("/thread/id").and_then(Value::as_str) != Some(id.as_str()) {
                return Err("SESSION_ACQUIRE_FAILED: 尚未发送，线程身份未确认".into());
            }
            if !child_input_allowed(&metadata["thread"]) {
                return Err("SUBAGENT_DIRECT_INPUT_DISABLED: 子线程由主 Agent 调度，消息尚未发送；请在主会话中跟进".into());
            }
        }
        let entry = self.entry(&id);
        let mut entry = entry.lock().await;
        // Keep operations serialized across delayed unload. Never retry the mutation itself.
        if entry.state == "releasing" {
            let until = Instant::now() + Duration::from_secs(8);
            while loaded_ids(rpc)
                .await
                .map_err(|error| {
                    format!("SESSION_ACQUIRE_FAILED: 尚未发送，无法确认执行实例：{error}")
                })?
                .contains(&id)
            {
                if Instant::now() >= until {
                    return Err(
                        "SESSION_RELEASE_PENDING: 会话仍在释放，请稍后重试；消息尚未发送".into(),
                    );
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            entry.state = "readonly";
            entry.releasing_since = None;
        }
        entry.generation += 1;
        if method != "thread/resume"
            && !loaded_ids(rpc)
                .await
                .map_err(|error| {
                    format!("SESSION_ACQUIRE_FAILED: 尚未发送，无法确认执行实例：{error}")
                })?
                .contains(&id)
        {
            entry.state = "acquiring";
            match rpc.raw("thread/resume", json!({"threadId":id,"config":{"features.default_mode_request_user_input":true}})).await {
                Ok(_) => { entry.state = "owned"; entry.reason.clear(); }
                Err(err) => {
                    entry.state = if writer_conflict(&err) { "external" } else { "unknown" };
                    entry.reason = if writer_conflict(&err) { "其他客户端正在使用，可查看历史；释放后可重试原消息".into() } else { err.clone() };
                    return Err(if writer_conflict(&err) { format!("SESSION_OWNED_ELSEWHERE: {}",entry.reason) } else { format!("SESSION_ACQUIRE_FAILED: 尚未发送，恢复执行实例失败：{err}") });
                }
            }
        }
        let result = rpc.raw(method, params).await;
        match &result {
            Ok(value) => {
                entry.state = "owned";
                entry.reason.clear();
                if matches!(method, "turn/start" | "review/start") {
                    // A new successful explicit execution supersedes a prior
                    // unknown operation; the gateway still protects uncertain
                    // submissions until the user resolves their outbox record.
                    entry.uncertain = false;
                }
                if method == "review/start"
                    && let Some(review_id) = value["reviewThreadId"]
                        .as_str()
                        .filter(|review_id| *review_id != id)
                {
                    self.entry(review_id).lock().await.state = "owned";
                }
            }
            Err(error) if writer_conflict(error) => {
                entry.state = "external";
                entry.reason = "其他客户端正在使用，可查看历史".into();
                return Err(format!("SESSION_OWNED_ELSEWHERE: {}", entry.reason));
            }
            Err(error) if error.starts_with("DELIVERY_UNKNOWN") => {
                entry.uncertain = true;
                entry.state = "unknown";
                entry.reason = "操作回执丢失，保留执行实例等待核对".into();
            }
            _ => {}
        }
        result
    }
    pub async fn release(&self, rpc: &impl Rpc, id: &str) -> Result<Value, String> {
        let entry = self.entry(id);
        let mut entry = entry.lock().await;
        if let Err(error) = self.release_locked(rpc, id, &mut entry).await {
            if entry.state != "releasing" {
                entry.state = "unknown";
            }
            entry.reason = format!("资源状态尚未确认，保留执行实例：{error}");
        }
        Ok(json!({"state":entry.state,"reason":entry.reason,"generation":entry.generation}))
    }
    pub async fn sweep(&self, rpc: &impl Rpc, id: &str) {
        let entry = self.entry(id);
        let Ok(mut entry) = entry.try_lock() else {
            return;
        };
        if matches!(entry.state, "readonly" | "external") {
            return;
        }
        if let Err(error) = self.release_locked(rpc, id, &mut entry).await {
            if entry.state != "releasing" {
                entry.state = "unknown";
            }
            entry.reason = format!("资源状态尚未确认，保留执行实例：{error}");
        }
    }
    async fn release_locked(
        &self,
        rpc: &impl Rpc,
        id: &str,
        entry: &mut Entry,
    ) -> Result<(), String> {
        let loaded = loaded_ids(rpc).await?;
        if !loaded.contains(id) {
            // loaded/list is authoritative even when the close notification was lost.
            entry.state = "readonly";
            entry.reason.clear();
            entry.releasing_since = None;
            return Ok(());
        }
        if entry.state == "releasing" {
            if entry
                .releasing_since
                .is_some_and(|when| when.elapsed() > Duration::from_secs(8))
            {
                entry.reason = "原生服务尚未确认卸载，仍等待释放".into();
            }
            return Ok(());
        }
        entry.state = "owned";
        if entry.uncertain {
            entry.reason = "操作送达结果待确认".into();
            return Ok(());
        }
        if let Some(reason) = self.hold(id) {
            entry.reason = reason;
            return Ok(());
        }
        let revision = self.signals.lock().unwrap().revision;
        let thread = rpc
            .raw("thread/read", json!({"threadId":id,"includeTurns":false}))
            .await?;
        if !matches!(
            thread
                .pointer("/thread/status/type")
                .and_then(Value::as_str),
            Some("idle" | "systemError")
        ) {
            entry.reason = "任务仍在运行、重试或等待交互".into();
            return Ok(());
        }
        let terminals = rpc
            .raw("thread/backgroundTerminals/list", json!({"threadId":id}))
            .await?;
        if !terminals["data"]
            .as_array()
            .ok_or("后台终端响应不完整")?
            .is_empty()
            || terminals["nextCursor"].is_string()
        {
            entry.reason = "会话仍有后台终端，释放会结束这些进程".into();
            return Ok(());
        }
        let goal = rpc.raw("thread/goal/get", json!({"threadId":id})).await?;
        if !goal.get("goal").is_some_and(|goal| {
            goal.is_null()
                || matches!(
                    goal["status"].as_str(),
                    Some("complete" | "paused" | "blocked" | "budgetLimited")
                )
        }) {
            entry.reason = "会话有活动目标或目标状态未知".into();
            return Ok(());
        }
        let mut parents = HashMap::new();
        for child in loaded.iter().filter(|child| child.as_str() != id) {
            let response = rpc
                .raw(
                    "thread/read",
                    json!({"threadId":child,"includeTurns":false}),
                )
                .await?;
            let t = &response["thread"];
            let parent = t["parentThreadId"].as_str().or_else(|| {
                t.pointer("/source/subAgent/thread_spawn/parent_thread_id")
                    .and_then(Value::as_str)
            });
            if let Some(parent) = parent {
                parents.insert(child.clone(), parent.to_owned());
            } else if t["source"].get("subAgent").is_some() {
                entry.reason = "子 Agent 归属尚未确认，保留执行实例".into();
                return Ok(());
            }
        }
        for child in parents.keys() {
            let mut current = child.as_str();
            let mut seen = HashSet::new();
            while let Some(parent) = parents.get(current) {
                if parent == id || !seen.insert(current) {
                    entry.reason = "仍有已加载的子 Agent，等待其退出后释放".into();
                    return Ok(());
                }
                current = parent;
            }
        }
        if self.signals.lock().unwrap().revision != revision || self.hold(id).is_some() {
            entry.reason = "状态发生变化，重新检查释放条件".into();
            return Ok(());
        }
        rpc.raw("thread/unsubscribe", json!({"threadId":id}))
            .await?;
        entry.state = "releasing";
        entry.reason = "等待原生服务关闭并释放写锁".into();
        entry.releasing_since = Some(Instant::now());
        Ok(())
    }
}
async fn loaded_ids(rpc: &impl Rpc) -> Result<HashSet<String>, String> {
    let mut ids = HashSet::new();
    let mut cursor = Value::Null;
    let mut seen = HashSet::new();
    loop {
        let page = rpc
            .raw("thread/loaded/list", json!({"cursor":cursor,"limit":100}))
            .await?;
        for id in page["data"]
            .as_array()
            .ok_or("loaded/list response missing data")?
        {
            ids.insert(id.as_str().ok_or("invalid loaded thread id")?.to_owned());
        }
        cursor = page["nextCursor"].clone();
        if cursor.is_null() {
            return Ok(ids);
        }
        if !seen.insert(cursor.to_string()) {
            return Err("repeated loaded/list cursor".into());
        }
    }
}

/// Full history without creating a live execution instance. Paginated histories
/// reject includeTurns, so read their turns and items through the read-only APIs.
pub async fn read_history(rpc: &impl Rpc, id: &str) -> Result<Value, String> {
    let mut result = rpc
        .raw("thread/read", json!({"threadId":id,"includeTurns":false}))
        .await?;
    if result
        .pointer("/thread/historyMode")
        .and_then(Value::as_str)
        != Some("paginated")
    {
        return rpc
            .raw("thread/read", json!({"threadId":id,"includeTurns":true}))
            .await;
    }
    let mut turns = vec![];
    let mut cursor = Value::Null;
    let mut seen = HashSet::new();
    loop {
        let page = rpc.raw("thread/turns/list",json!({"threadId":id,"cursor":cursor,"limit":100,"sortDirection":"asc","itemsView":"full"})).await?;
        turns.extend(
            page["data"]
                .as_array()
                .ok_or("turns/list response missing data")?
                .clone(),
        );
        cursor = page["nextCursor"].clone();
        if cursor.is_null() {
            break;
        }
        if !seen.insert(cursor.to_string()) {
            return Err("repeated turns/list cursor".into());
        }
    }
    result["thread"]["turns"] = Value::Array(turns);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex as SyncMutex;

    struct Fake {
        calls: SyncMutex<Vec<String>>,
        loaded: SyncMutex<bool>,
        blocked: bool,
        background: bool,
        active: bool,
    }
    impl Fake {
        fn idle() -> Self {
            Self {
                calls: SyncMutex::new(vec![]),
                loaded: SyncMutex::new(false),
                blocked: false,
                background: false,
                active: false,
            }
        }
    }
    #[async_trait::async_trait]
    impl Rpc for Fake {
        async fn raw(&self, method: &str, _params: Value) -> Result<Value, String> {
            self.calls.lock().unwrap().push(method.into());
            match method {
                "thread/loaded/list" => Ok(
                    json!({"data": if *self.loaded.lock().unwrap() {vec!["t"]} else {vec![]}, "nextCursor":null}),
                ),
                "thread/resume" if self.blocked => {
                    Err("Thread t already has an active writer".into())
                }
                "thread/resume" => {
                    *self.loaded.lock().unwrap() = true;
                    Ok(json!({"thread":{"id":"t"}}))
                }
                "thread/read" => Ok(
                    json!({"thread":{"id":"t","turns":[],"status":{"type":if self.active {"active"} else {"idle"}},"source":"cli"}}),
                ),
                "thread/backgroundTerminals/list" => Ok(
                    json!({"data":if self.background {vec![json!({"id":"p"})]} else {vec![]},"nextCursor":null}),
                ),
                "thread/goal/get" => Ok(json!({"goal":null})),
                "thread/unsubscribe" => Ok(json!({"status":"unsubscribed"})),
                "turn/start" => Ok(json!({"turn":{"id":"turn","status":"inProgress"}})),
                _ => Err(format!("unexpected {method}")),
            }
        }
    }
    #[test]
    fn restricted_or_unknown_child_cannot_acquire_for_input_but_interrupt_is_separate() {
        assert!(!child_input_allowed(&json!({"parentThreadId":"parent","canAcceptDirectInput":false})));
        assert!(!child_input_allowed(&json!({"source":{"subAgent":{"thread_spawn":{"parent_thread_id":"parent"}}}})));
        assert!(child_input_allowed(&json!({"parentThreadId":"parent","canAcceptDirectInput":true})));
        assert!(child_input_allowed(&json!({"source":"cli"})));
        assert!(direct_input("turn/start"));
        assert!(!direct_input("turn/interrupt"));
    }
    struct ChildGuard {
        thread: Value,
        calls: SyncMutex<Vec<String>>,
    }
    #[async_trait::async_trait]
    impl Rpc for ChildGuard {
        async fn raw(&self, method: &str, _params: Value) -> Result<Value, String> {
            self.calls.lock().unwrap().push(method.into());
            if method == "thread/read" { Ok(json!({"thread": self.thread})) }
            else { Err(format!("unexpected mutation {method}")) }
        }
    }
    #[tokio::test]
    async fn child_gate_and_identity_failure_never_resume_or_send() {
        for metadata in [
            json!({"id":"child","parentThreadId":"parent","canAcceptDirectInput":false}),
            json!({"id":"child","parentThreadId":"parent"}),
            json!({"id":"other","canAcceptDirectInput":true}),
        ] {
            let rpc = ChildGuard { thread: metadata, calls: SyncMutex::new(vec![]) };
            let err = ready().call(&rpc, "turn/start", json!({"threadId":"child"})).await.unwrap_err();
            assert!(err.contains("尚未发送"));
            assert_eq!(*rpc.calls.lock().unwrap(), ["thread/read"]);
        }
    }
    fn ready() -> Ownership {
        let owner = Ownership::default();
        owner.queue_update(false, vec![]);
        owner
    }
    #[tokio::test]
    async fn reading_does_not_acquire() {
        let rpc = Fake::idle();
        let owner = ready();
        owner
            .call(&rpc, "thread/read", json!({"threadId":"t"}))
            .await
            .unwrap();
        assert_eq!(*rpc.calls.lock().unwrap(), ["thread/read"]);
    }
    #[tokio::test]
    async fn execution_acquires_same_thread_once() {
        let rpc = Fake::idle();
        let owner = ready();
        owner
            .call(
                &rpc,
                "turn/start",
                json!({"threadId":"t","clientUserMessageId":"m"}),
            )
            .await
            .unwrap();
        owner
            .call(&rpc, "turn/interrupt", json!({"threadId":"t"}))
            .await
            .unwrap_err();
        let calls = rpc.calls.lock().unwrap();
        assert_eq!(calls.iter().filter(|m| *m == "thread/resume").count(), 1);
        assert_eq!(calls.iter().filter(|m| *m == "turn/start").count(), 1);
    }
    #[tokio::test]
    async fn external_writer_rejects_before_sending() {
        let rpc = Fake {
            blocked: true,
            ..Fake::idle()
        };
        let owner = ready();
        let err = owner
            .call(&rpc, "turn/start", json!({"threadId":"t"}))
            .await
            .unwrap_err();
        assert!(err.starts_with("SESSION_OWNED_ELSEWHERE"));
        assert!(!rpc.calls.lock().unwrap().iter().any(|m| m == "turn/start"));
        assert_eq!(owner.access("t").await["state"], "external");
    }
    #[tokio::test]
    async fn unsubscribe_ack_is_not_release_confirmation() {
        let rpc = Fake {
            loaded: SyncMutex::new(true),
            ..Fake::idle()
        };
        let owner = ready();
        owner.release(&rpc, "t").await.unwrap();
        assert_eq!(owner.access("t").await["state"], "releasing");
        owner.observe("thread/closed", &json!({"threadId":"t"}));
        // Even a close notification is insufficient while the current instance still has it loaded.
        owner.release(&rpc, "t").await.unwrap();
        assert_eq!(owner.access("t").await["state"], "releasing");
        *rpc.loaded.lock().unwrap() = false;
        owner.release(&rpc, "t").await.unwrap();
        assert_eq!(owner.access("t").await["state"], "readonly");
    }
    #[tokio::test]
    async fn background_work_and_unknown_queue_prevent_unload() {
        for (owner, rpc) in [
            (
                Ownership::default(),
                Fake {
                    loaded: SyncMutex::new(true),
                    ..Fake::idle()
                },
            ),
            (
                ready(),
                Fake {
                    loaded: SyncMutex::new(true),
                    background: true,
                    ..Fake::idle()
                },
            ),
            (
                ready(),
                Fake {
                    loaded: SyncMutex::new(true),
                    active: true,
                    ..Fake::idle()
                },
            ),
        ] {
            owner.release(&rpc, "t").await.unwrap();
            assert_ne!(owner.access("t").await["state"], "releasing");
            assert!(
                !rpc.calls
                    .lock()
                    .unwrap()
                    .contains(&"thread/unsubscribe".to_owned())
            );
        }
    }
    #[tokio::test]
    async fn pending_approval_and_queue_hold_prevent_unload() {
        let rpc = Fake {
            loaded: SyncMutex::new(true),
            ..Fake::idle()
        };
        let owner = ready();
        owner.pending_request("r".into(), "t".into());
        owner.release(&rpc, "t").await.unwrap();
        assert!(
            !rpc.calls
                .lock()
                .unwrap()
                .contains(&"thread/unsubscribe".to_owned())
        );
        owner.resolve_request("r");
        owner.queue_update(false, vec!["t".into()]);
        owner.release(&rpc, "t").await.unwrap();
        assert!(
            !rpc.calls
                .lock()
                .unwrap()
                .contains(&"thread/unsubscribe".to_owned())
        );
    }
    #[tokio::test]
    async fn old_queue_snapshots_and_stale_heartbeats_cannot_allow_release() {
        let owner = Ownership::default();
        assert!(owner.queue_update_ordered(200, false, vec!["t".into()]));
        assert!(!owner.queue_update_ordered(199, false, vec![]));
        assert!(owner.hold("t").is_some());
        assert!(owner.queue_update_ordered(201, false, vec![]));
        assert!(owner.hold("t").is_none());
        owner.signals.lock().unwrap().queue.as_mut().unwrap().0 =
            Instant::now() - Duration::from_secs(11);
        assert!(owner.hold("t").is_some());
    }
    #[tokio::test]
    async fn late_close_does_not_clear_a_new_execution() {
        let rpc = Fake {
            active: true,
            ..Fake::idle()
        };
        let owner = ready();
        owner
            .call(&rpc, "turn/start", json!({"threadId":"t"}))
            .await
            .unwrap();
        let generation = owner.access("t").await["generation"].clone();
        owner.observe("thread/closed", &json!({"threadId":"t"}));
        owner.release(&rpc, "t").await.unwrap();
        assert_eq!(owner.access("t").await["state"], "owned");
        assert_eq!(owner.access("t").await["generation"], generation);
        assert!(
            !rpc.calls
                .lock()
                .unwrap()
                .contains(&"thread/unsubscribe".into())
        );
    }
    struct Uncertain(Fake);
    #[async_trait]
    impl Rpc for Uncertain {
        async fn raw(&self, method: &str, params: Value) -> Result<Value, String> {
            let result = self.0.raw(method, params).await;
            if method == "turn/start" {
                Err("DELIVERY_UNKNOWN: disconnected".into())
            } else {
                result
            }
        }
    }
    #[tokio::test]
    async fn missing_mutation_ack_never_retries_or_releases() {
        let rpc = Uncertain(Fake::idle());
        let owner = ready();
        assert!(
            owner
                .call(&rpc, "turn/start", json!({"threadId":"t"}))
                .await
                .is_err()
        );
        owner.release(&rpc, "t").await.unwrap();
        let calls = rpc.0.calls.lock().unwrap();
        assert_eq!(calls.iter().filter(|m| *m == "turn/start").count(), 1);
        assert!(!calls.contains(&"thread/unsubscribe".into()));
    }
    struct Pages {
        calls: SyncMutex<Vec<String>>,
    }
    #[async_trait]
    impl Rpc for Pages {
        async fn raw(&self, method: &str, params: Value) -> Result<Value, String> {
            self.calls.lock().unwrap().push(method.into());
            match method {
                "thread/read" => Ok(json!({"thread":{"id":"p","historyMode":"paginated"}})),
                "thread/turns/list" => {
                    assert_eq!(params["itemsView"], "full");
                    assert_eq!(params["sortDirection"], "asc");
                    if params["cursor"].is_null() {
                        Ok(
                            json!({"data":[{"id":"old","items":[{"text":"original"}]}],"nextCursor":"next"}),
                        )
                    } else {
                        Ok(
                            json!({"data":[{"id":"new","items":[{"text":"latest"}]}],"nextCursor":null}),
                        )
                    }
                }
                _ => Err("unexpected writer operation".into()),
            }
        }
    }
    #[tokio::test]
    async fn paginated_history_reads_all_pages_without_resuming() {
        let rpc = Pages {
            calls: SyncMutex::new(vec![]),
        };
        let result = read_history(&rpc, "p").await.unwrap();
        assert_eq!(result["thread"]["turns"][0]["items"][0]["text"], "original");
        assert_eq!(result["thread"]["turns"][1]["items"][0]["text"], "latest");
        assert_eq!(
            *rpc.calls.lock().unwrap(),
            ["thread/read", "thread/turns/list", "thread/turns/list"]
        );
    }
    struct Resource(Fake, &'static str, Result<Value, String>);
    #[async_trait]
    impl Rpc for Resource {
        async fn raw(&self, method: &str, params: Value) -> Result<Value, String> {
            if method == self.1 {
                self.2.clone()
            } else {
                self.0.raw(method, params).await
            }
        }
    }
    #[tokio::test]
    async fn active_goal_and_failed_resource_queries_retain_the_instance() {
        for (method, result) in [
            ("thread/goal/get", Ok(json!({"goal":{"status":"active"}}))),
            (
                "thread/backgroundTerminals/list",
                Err("unsupported resource query".into()),
            ),
            ("thread/goal/get", Ok(json!({}))),
            ("thread/loaded/list", Err("connection lost".into())),
        ] {
            let rpc = Resource(
                Fake {
                    loaded: SyncMutex::new(true),
                    ..Fake::idle()
                },
                method,
                result,
            );
            let owner = ready();
            let access = owner.release(&rpc, "t").await.unwrap();
            assert!(matches!(
                access["state"].as_str(),
                Some("owned" | "unknown")
            ));
            assert!(!access["reason"].as_str().unwrap().is_empty());
            assert!(
                !rpc.0
                    .calls
                    .lock()
                    .unwrap()
                    .contains(&"thread/unsubscribe".into())
            );
        }
    }
    #[tokio::test]
    async fn acquisition_failure_is_definitively_unsent() {
        let rpc = Resource(
            Fake::idle(),
            "thread/resume",
            Err("DELIVERY_UNKNOWN: lost resume ack".into()),
        );
        let owner = ready();
        let error = owner
            .call(&rpc, "turn/start", json!({"threadId":"t"}))
            .await
            .unwrap_err();
        assert!(error.starts_with("SESSION_ACQUIRE_FAILED"));
        assert!(!rpc.0.calls.lock().unwrap().contains(&"turn/start".into()));
    }
    struct Family(Fake, Option<&'static str>);
    #[async_trait]
    impl Rpc for Family {
        async fn raw(&self, method: &str, params: Value) -> Result<Value, String> {
            if method == "thread/loaded/list" {
                return Ok(json!({"data":["t","child"],"nextCursor":null}));
            }
            if method == "thread/read" && params["threadId"] == "child" {
                return Ok(
                    json!({"thread":{"parentThreadId":self.1,"source":{"subAgent":"review"}}}),
                );
            }
            self.0.raw(method, params).await
        }
    }
    #[tokio::test]
    async fn related_or_unidentifiable_children_hold_the_parent_but_unrelated_children_do_not() {
        for (parent, expected) in [
            (Some("t"), "owned"),
            (None, "owned"),
            (Some("another-root"), "releasing"),
        ] {
            let rpc = Family(Fake::idle(), parent);
            let owner = ready();
            assert_eq!(owner.release(&rpc, "t").await.unwrap()["state"], expected);
        }
    }
    struct ActivityRace<'a>(Fake, &'a Ownership);
    #[async_trait]
    impl Rpc for ActivityRace<'_> {
        async fn raw(&self, method: &str, params: Value) -> Result<Value, String> {
            if method == "thread/goal/get" {
                self.1.queue_update(false, vec!["t".into()]);
            }
            self.0.raw(method, params).await
        }
    }
    #[tokio::test]
    async fn new_queue_work_during_resource_check_cancels_unsubscribe() {
        let owner = ready();
        let rpc = ActivityRace(
            Fake {
                loaded: SyncMutex::new(true),
                ..Fake::idle()
            },
            &owner,
        );
        owner.release(&rpc, "t").await.unwrap();
        assert!(
            !rpc.0
                .calls
                .lock()
                .unwrap()
                .contains(&"thread/unsubscribe".into())
        );
    }
}
