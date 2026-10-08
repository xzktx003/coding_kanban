use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast;

/// How many recent events are retained for replay. Sized so a mobile client
/// backgrounded for a minute or two can still catch up without a full reload.
const REPLAY_BUFFER_CAPACITY: usize = 2048;

/// Fan-out capacity for connected clients. Each subscriber that falls this far
/// behind is dropped by `broadcast`, but the client recovers on reconnect via
/// `?since=`, so lagging costs a reconnect rather than losing data.
const SUBSCRIBER_CHANNEL_CAPACITY: usize = 1024;

/// An event stamped with a monotonically increasing sequence number.
///
/// The sequence number is what makes reconnects lossless: a client records the
/// highest `seq` it has processed and asks for everything after it.
#[derive(Clone, Debug, Serialize)]
pub struct SeqEvent {
    pub seq: u64,
    pub event: String,
    pub payload: Value,
}

/// Extracts the namespace an event belongs to, used by the `agents` filter.
///
/// Event names grew inconsistent over time (`codex:notification` uses a colon,
/// `codex/approval-request` a slash, `cc-message` a hyphen, `fs_change` an
/// underscore) and they double as Tauri event names on the desktop side, so
/// renaming them would mean touching the desktop listeners too. Normalizing
/// here keeps that churn out of the picture.
fn namespace_of(event: &str) -> &str {
    match event {
        "cc-message" => "cc",
        "fs_change" => "fs",
        _ => event.split([':', '/']).next().unwrap_or(event),
    }
}

/// Parses the `agents` query value (e.g. `codex,terminal`) into a filter set.
/// `None` means "no filtering" — every event is delivered.
pub fn parse_namespace_filter(agents: Option<&str>) -> Option<HashSet<String>> {
    let raw = agents?;
    let set: HashSet<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if set.is_empty() { None } else { Some(set) }
}

pub fn event_matches(filter: Option<&HashSet<String>>, event: &str) -> bool {
    match filter {
        None => true,
        Some(set) => set.contains(namespace_of(event)),
    }
}

struct Inner {
    buffer: VecDeque<SeqEvent>,
    next_seq: u64,
    // Waiting RPCs outlive the bounded token/event replay buffer. Memory only:
    // they are invalid once this runtime/app-server instance goes away.
    user_inputs: HashMap<String, SeqEvent>,
    pending_requests: HashMap<String, SeqEvent>,
    claimed_replies: HashSet<String>,
}

fn input_key(payload: &Value) -> Option<String> {
    let thread = payload.get("threadId")?.as_str()?;
    let id = payload.get("requestId")?;
    if !id.is_string() && !id.is_i64() {
        return None;
    }
    Some(serde_json::json!([thread, id]).to_string())
}

fn update_user_inputs(inner: &mut Inner, event: &SeqEvent) {
    if event.event == "codex/request-user-input" {
        if let Some(key) = input_key(&event.payload) {
            inner.user_inputs.insert(key, event.clone());
        }
    } else if event.event == "codex:notification" {
        let params = &event.payload["params"];
        match event.payload["method"].as_str() {
            Some("serverRequest/resolved") => {
                if let Some(key) = input_key(params) {
                    inner.user_inputs.remove(&key);
                }
            }
            Some("error") if params["willRetry"] == false => {
                inner.user_inputs.retain(|_, request| {
                    request.payload["threadId"] != params["threadId"]
                        || request.payload["turnId"] != params["turnId"]
                })
            }
            Some("turn/completed") => inner.user_inputs.retain(|_, request| {
                request.payload["threadId"] != params["threadId"]
                    || request.payload["turnId"] != params["turn"]["id"]
            }),
            Some("thread/closed" | "thread/deleted") => inner
                .user_inputs
                .retain(|_, request| request.payload["threadId"] != params["threadId"]),
            _ => {}
        }
    }
}

fn update_pending_requests(inner: &mut Inner, event: &SeqEvent) {
    if matches!(
        event.event.as_str(),
        "codex/request-user-input"
            | "codex/approval-request"
            | "codex/permissions-request"
            | "codex/elicitation-request"
    ) {
        if let Some(key) = input_key(&event.payload) {
            inner.pending_requests.insert(key, event.clone());
        }
        return;
    }
    if event.event != "codex:notification" {
        return;
    }
    let p = &event.payload["params"];
    match event.payload["method"].as_str() {
        Some("serverRequest/resolved") => {
            if let Some(key) = input_key(p) {
                inner.pending_requests.remove(&key);
            }
        }
        Some("turn/completed") => inner.pending_requests.retain(|_, r| {
            r.payload["threadId"] != p["threadId"] || r.payload["turnId"] != p["turn"]["id"]
        }),
        Some("error") if p["willRetry"] == false => inner.pending_requests.retain(|_, r| {
            r.payload["threadId"] != p["threadId"] || r.payload["turnId"] != p["turnId"]
        }),
        Some("thread/closed" | "thread/deleted") => inner
            .pending_requests
            .retain(|_, r| r.payload["threadId"] != p["threadId"]),
        _ => {}
    }
}

/// Stamps every emitted event with a sequence number, keeps a bounded replay
/// buffer, and fans out to connected WebSocket/SSE clients.
#[derive(Clone)]
pub struct EventHub {
    inner: Arc<Mutex<Inner>>,
    tx: broadcast::Sender<SeqEvent>,
}

impl EventHub {
    /// Bind a reply to its live RPC and instance marker. An unknown delivery
    /// outcome stays claimed until resolution, preventing an automatic resend.
    pub fn claim_reply(&self, request: &Value, id: &Value, event: &str, kind: &str) -> bool {
        let Some(key) = input_key(request) else { return false };
        let mut inner = self.inner.lock().expect("event hub mutex poisoned");
        let Some(live) = inner.pending_requests.get(&key) else { return false };
        if request["requestId"] != *id || live.event != event || live.payload["type"] != kind { return false }
        for field in ["turnId", "itemId", "requestToken"] {
            if request[field] != live.payload[field] { return false }
        }
        let claim = serde_json::json!([key, live.payload["requestToken"]]).to_string();
        inner.claimed_replies.insert(claim)
    }
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(SUBSCRIBER_CHANNEL_CAPACITY);
        Self {
            inner: Arc::new(Mutex::new(Inner {
                buffer: VecDeque::with_capacity(REPLAY_BUFFER_CAPACITY),
                next_seq: 1,
                user_inputs: HashMap::new(),
                pending_requests: HashMap::new(),
                claimed_replies: HashSet::new(),
            })),
            tx,
        }
    }

    /// Consumes the raw `(event, payload)` broadcast and republishes it with
    /// sequence numbers. A single consumer keeps the ordering total.
    pub fn spawn_from(source: &broadcast::Sender<(String, Value)>) -> Self {
        let hub = Self::new();
        let mut rx = source.subscribe();
        let sink = hub.clone();

        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok((event, payload)) => sink.publish(event, payload),
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        // Events were dropped before they could be stamped, so
                        // they are unrecoverable — no seq was ever assigned.
                        // Log loudly: this means the source channel is undersized.
                        log::error!(
                            "[events] event hub lagged, {skipped} events lost before sequencing"
                        );
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        hub
    }

    fn publish(&self, event: String, payload: Value) {
        let stamped = {
            let mut inner = self.inner.lock().expect("event hub mutex poisoned");
            let seq = inner.next_seq;
            inner.next_seq += 1;

            let stamped = SeqEvent {
                seq,
                event,
                payload,
            };
            update_user_inputs(&mut inner, &stamped);
            update_pending_requests(&mut inner, &stamped);
            if !inner.claimed_replies.is_empty() {
                let live: HashSet<String> = inner.pending_requests.values().filter_map(|r| input_key(&r.payload).map(|key| serde_json::json!([key, r.payload["requestToken"]]).to_string())).collect();
                inner.claimed_replies.retain(|claim| live.contains(claim));
            }
            inner.buffer.push_back(stamped.clone());
            while inner.buffer.len() > REPLAY_BUFFER_CAPACITY {
                inner.buffer.pop_front();
            }
            stamped
        };

        // Err only means nobody is connected right now; the event is still buffered.
        let _ = self.tx.send(stamped);
    }

    /// Atomically snapshots the replay backlog and subscribes to live events.
    ///
    /// Both happen under the same lock that `publish` takes, so an event cannot
    /// slip between the snapshot and the subscription — the client sees no gap
    /// and no duplicate.
    pub fn subscribe(
        &self,
        since: Option<u64>,
        filter: Option<&HashSet<String>>,
    ) -> (Vec<SeqEvent>, broadcast::Receiver<SeqEvent>) {
        self.subscribe_inner(since, filter, false)
    }

    /// Replay first, then reconcile pending questions at the same atomic cursor.
    /// A snapshot can share the replay's last sequence; clients must process it.
    pub fn subscribe_with_questions(
        &self,
        since: Option<u64>,
        filter: Option<&HashSet<String>>,
    ) -> (Vec<SeqEvent>, broadcast::Receiver<SeqEvent>) {
        self.subscribe_inner(since, filter, true)
    }

    fn subscribe_inner(
        &self,
        since: Option<u64>,
        filter: Option<&HashSet<String>>,
        questions: bool,
    ) -> (Vec<SeqEvent>, broadcast::Receiver<SeqEvent>) {
        let inner = self.inner.lock().expect("event hub mutex poisoned");
        let rx = self.tx.subscribe();

        let mut backlog: Vec<SeqEvent> = match since {
            Some(since) => inner
                .buffer
                .iter()
                .filter(|e| e.seq > since && event_matches(filter, &e.event))
                .cloned()
                .collect(),
            // A fresh client has no cursor and does not want history replayed.
            None => Vec::new(),
        };

        if questions && event_matches(filter, "codex/user-input-snapshot") {
            let mut requests: Vec<&SeqEvent> = inner.user_inputs.values().collect();
            requests.sort_by_key(|e| e.seq);
            // Empty fresh connections already start with empty client stores.
            // Reconnect always sends an empty snapshot to clear stale prompts.
            if since.is_some() || !requests.is_empty() {
                backlog.push(SeqEvent {
                    seq: inner.next_seq - 1,
                    event: "codex/user-input-snapshot".into(),
                    payload: serde_json::json!({"requests": requests.iter().map(|e| &e.payload).collect::<Vec<_>>()}),
                });
            }
        }

        if questions
            && event_matches(filter, "codex/pending-requests-snapshot")
            && (since.is_some() || !inner.pending_requests.is_empty())
        {
            let mut requests: Vec<&SeqEvent> = inner.pending_requests.values().collect();
            requests.sort_by_key(|e| e.seq);
            backlog.push(SeqEvent { seq: inner.next_seq - 1, event: "codex/pending-requests-snapshot".into(),
                payload: serde_json::json!({"requests": requests.iter().map(|e| serde_json::json!({"event": e.event, "payload": e.payload})).collect::<Vec<_>>()}) });
        }
        (backlog, rx)
    }
}

impl Default for EventHub {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn filter(spec: &str) -> Option<HashSet<String>> {
        parse_namespace_filter(Some(spec))
    }

    #[test]
    fn replies_match_full_request_identity_and_are_claimed_once() {
        let hub = EventHub::new();
        let request = json!({"threadId":"child","turnId":"turn","itemId":"item","requestId":1,"type":"commandExecution","requestToken":"instance-one"});
        hub.publish("codex/approval-request".into(), request.clone());
        for (field, value) in [("threadId", "parent"), ("turnId", "old"), ("itemId", "other"), ("requestToken", "instance-two")] {
            let mut wrong = request.clone(); wrong[field] = json!(value);
            assert!(!hub.claim_reply(&wrong, &json!(1), "codex/approval-request", "commandExecution"));
        }
        assert!(!hub.claim_reply(&request, &json!(1), "codex/approval-request", "fileChange"));
        assert!(hub.claim_reply(&request, &json!(1), "codex/approval-request", "commandExecution"));
        assert!(!hub.claim_reply(&request, &json!(1), "codex/approval-request", "commandExecution"));
        hub.publish("codex:notification".into(), json!({"method":"serverRequest/resolved","params":{"threadId":"child","requestId":1}}));
        assert!(!hub.claim_reply(&request, &json!(1), "codex/approval-request", "commandExecution"));
    }
    #[test]
    fn namespace_handles_every_naming_style_in_use() {
        assert_eq!(namespace_of("codex:notification"), "codex");
        assert_eq!(namespace_of("codex/approval-request"), "codex");
        assert_eq!(namespace_of("terminal:data"), "terminal");
        assert_eq!(namespace_of("cc-message"), "cc");
        assert_eq!(namespace_of("fs_change"), "fs");
    }

    #[test]
    fn absent_filter_matches_everything() {
        assert!(event_matches(None, "cc-message"));
        assert!(event_matches(None, "codex:notification"));
    }

    #[test]
    fn filter_selects_by_namespace() {
        let codex_only = filter("codex");
        assert!(event_matches(codex_only.as_ref(), "codex:notification"));
        assert!(event_matches(codex_only.as_ref(), "codex/approval-request"));
        assert!(!event_matches(codex_only.as_ref(), "cc-message"));
        assert!(!event_matches(codex_only.as_ref(), "terminal:data"));

        let multi = filter("codex, terminal");
        assert!(event_matches(multi.as_ref(), "terminal:data"));
        assert!(event_matches(multi.as_ref(), "codex:stderr"));
        assert!(!event_matches(multi.as_ref(), "cc-message"));
    }

    #[test]
    fn empty_filter_spec_is_treated_as_no_filter() {
        assert!(parse_namespace_filter(Some("")).is_none());
        assert!(parse_namespace_filter(Some(" , ")).is_none());
        assert!(parse_namespace_filter(None).is_none());
    }

    #[test]
    fn sequence_numbers_start_at_one_and_increase() {
        let hub = EventHub::new();
        hub.publish("codex:notification".into(), json!({ "n": 1 }));
        hub.publish("codex:notification".into(), json!({ "n": 2 }));

        let (backlog, _rx) = hub.subscribe(Some(0), None);
        assert_eq!(
            backlog.iter().map(|e| e.seq).collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    #[test]
    fn since_replays_only_newer_events() {
        let hub = EventHub::new();
        for n in 0..5 {
            hub.publish("codex:notification".into(), json!({ "n": n }));
        }

        let (backlog, _rx) = hub.subscribe(Some(3), None);
        assert_eq!(
            backlog.iter().map(|e| e.seq).collect::<Vec<_>>(),
            vec![4, 5]
        );
    }

    #[test]
    fn fresh_client_without_cursor_gets_no_history() {
        let hub = EventHub::new();
        hub.publish("codex:notification".into(), json!({}));

        let (backlog, _rx) = hub.subscribe(None, None);
        assert!(backlog.is_empty());
    }

    #[test]
    fn replay_respects_the_namespace_filter() {
        let hub = EventHub::new();
        hub.publish("codex:notification".into(), json!({}));
        hub.publish("cc-message".into(), json!({}));
        hub.publish("codex:stderr".into(), json!({}));

        let codex_only = filter("codex");
        let (backlog, _rx) = hub.subscribe(Some(0), codex_only.as_ref());
        assert_eq!(
            backlog.iter().map(|e| e.seq).collect::<Vec<_>>(),
            vec![1, 3]
        );
    }

    #[test]
    fn buffer_is_bounded_and_drops_oldest_first() {
        let hub = EventHub::new();
        for _ in 0..(REPLAY_BUFFER_CAPACITY + 10) {
            hub.publish("codex:notification".into(), json!({}));
        }

        let (backlog, _rx) = hub.subscribe(Some(0), None);
        assert_eq!(backlog.len(), REPLAY_BUFFER_CAPACITY);
        // Oldest surviving event is the 11th published one.
        assert_eq!(backlog.first().expect("non-empty backlog").seq, 11);
    }

    #[tokio::test]
    async fn reconnect_across_a_publish_loses_nothing() {
        let hub = EventHub::new();
        hub.publish("codex:notification".into(), json!({ "n": 1 }));

        // Client processed seq 1, then dropped its connection.
        let last_seen = 1;

        // Events continue to arrive while the client is away.
        hub.publish("codex:notification".into(), json!({ "n": 2 }));
        hub.publish("codex:notification".into(), json!({ "n": 3 }));

        // Client reconnects with its cursor.
        let (backlog, mut rx) = hub.subscribe(Some(last_seen), None);
        assert_eq!(
            backlog.iter().map(|e| e.seq).collect::<Vec<_>>(),
            vec![2, 3]
        );

        // Live events continue from where the backlog ended, with no overlap.
        hub.publish("codex:notification".into(), json!({ "n": 4 }));
        let live = rx.recv().await.expect("receive live event");
        assert_eq!(live.seq, 4);
    }

    #[tokio::test]
    async fn stamps_events_from_the_source_channel() {
        let (tx, _) = broadcast::channel(16);
        let hub = EventHub::spawn_from(&tx);

        let (_, mut rx) = hub.subscribe(None, None);
        tx.send(("codex:notification".to_string(), json!({ "ok": true })))
            .expect("send source event");

        let received = tokio::time::timeout(std::time::Duration::from_secs(5), rx.recv())
            .await
            .expect("timed out waiting for stamped event")
            .expect("hub channel closed");

        assert_eq!(received.seq, 1);
        assert_eq!(received.event, "codex:notification");
        assert_eq!(received.payload, json!({ "ok": true }));
    }

    #[test]
    fn pending_questions_survive_buffer_eviction_and_fresh_browser_connections() {
        let hub = EventHub::new();
        let question = json!({"threadId":"a","turnId":"turn","requestId":"rpc","questions":[]});
        hub.publish("codex/request-user-input".into(), question.clone());
        for _ in 0..REPLAY_BUFFER_CAPACITY + 1 {
            hub.publish("cc-message".into(), json!({}));
        }
        let (backlog, _) = hub.subscribe_with_questions(None, None);
        let snapshot = backlog
            .iter()
            .find(|e| e.event == "codex/user-input-snapshot")
            .expect("pending snapshot");
        assert_eq!(snapshot.payload["requests"], json!([question]));
        hub.publish(
            "codex:notification".into(),
            json!({"method":"serverRequest/resolved","params":{"threadId":"a","requestId":"rpc"}}),
        );
        let (backlog, _) = hub.subscribe_with_questions(Some(1), None);
        assert_eq!(
            backlog.last().expect("snapshot").payload["requests"],
            json!([])
        );
    }

    #[test]
    fn completion_clears_only_its_turn_and_snapshot_respects_namespace() {
        let hub = EventHub::new();
        hub.publish(
            "codex/request-user-input".into(),
            json!({"threadId":"a","turnId":"old","requestId":1}),
        );
        hub.publish(
            "codex/request-user-input".into(),
            json!({"threadId":"a","turnId":"new","requestId":"1"}),
        );
        hub.publish(
            "codex:notification".into(),
            json!({"method":"turn/completed","params":{"threadId":"a","turn":{"id":"old"}}}),
        );
        let (backlog, _) = hub.subscribe_with_questions(None, None);
        assert_eq!(backlog[0].payload["requests"][0]["turnId"], "new");
        let (cc, _) = hub.subscribe_with_questions(None, filter("cc").as_ref());
        assert!(cc.is_empty());
    }
    #[test]
    fn all_pending_rpcs_survive_refresh_and_expire_only_for_their_owner() {
        let hub = EventHub::new();
        for (i, event) in [
            "codex/approval-request",
            "codex/permissions-request",
            "codex/elicitation-request",
            "codex/request-user-input",
        ]
        .iter()
        .enumerate()
        {
            hub.publish(
                (*event).into(),
                json!({"threadId":"a","turnId":"old","requestId":i}),
            );
        }
        hub.publish(
            "codex/approval-request".into(),
            json!({"threadId":"b","turnId":"other","requestId":10}),
        );
        for _ in 0..REPLAY_BUFFER_CAPACITY + 1 {
            hub.publish("cc-message".into(), json!({}));
        }
        let (fresh, _) = hub.subscribe_with_questions(None, None);
        let snapshot = fresh
            .iter()
            .find(|e| e.event == "codex/pending-requests-snapshot")
            .unwrap();
        assert_eq!(snapshot.payload["requests"].as_array().unwrap().len(), 5);
        hub.publish(
            "codex:notification".into(),
            json!({"method":"error","params":{"threadId":"a","turnId":"old","willRetry":true}}),
        );
        assert_eq!(hub.inner.lock().unwrap().pending_requests.len(), 5);
        hub.publish(
            "codex:notification".into(),
            json!({"method":"error","params":{"threadId":"a","turnId":"old","willRetry":false}}),
        );
        let (after, _) = hub.subscribe_with_questions(Some(0), None);
        let snapshot = after
            .iter()
            .find(|e| e.event == "codex/pending-requests-snapshot")
            .unwrap();
        assert_eq!(snapshot.payload["requests"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot.payload["requests"][0]["payload"]["threadId"], "b");
        hub.publish(
            "codex:notification".into(),
            json!({"method":"serverRequest/resolved","params":{"threadId":"b","requestId":10}}),
        );
        let (done, _) = hub.subscribe_with_questions(Some(0), None);
        assert_eq!(done.last().unwrap().payload["requests"], json!([]));
    }
}
