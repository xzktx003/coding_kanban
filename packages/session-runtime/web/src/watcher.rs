use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher, recommended_watcher};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::{Mutex, broadcast};

#[derive(Default)]
pub struct WebWatchState {
    pub(crate) watchers: Arc<Mutex<HashMap<String, (RecommendedWatcher, usize)>>>,
}

fn expand_path(input: &str) -> Result<PathBuf, String> {
    if let Some(rest) = input.strip_prefix("~/") {
        let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
        Ok(home.join(rest))
    } else {
        Ok(Path::new(input).to_path_buf())
    }
}

fn kind_to_string(kind: &EventKind) -> String {
    use notify::event::*;
    match kind {
        EventKind::Create(CreateKind::Any) => "create".into(),
        EventKind::Create(_) => "create".into(),
        EventKind::Modify(ModifyKind::Any) => "modify".into(),
        EventKind::Modify(_) => "modify".into(),
        EventKind::Remove(RemoveKind::Any) => "remove".into(),
        EventKind::Remove(_) => "remove".into(),
        EventKind::Access(_) => "access".into(),
        EventKind::Other => "other".into(),
        EventKind::Any => "any".into(),
    }
}

/// Preflight traversal is bounded, so browsing a large home/cache tree cannot
/// exhaust inotify handles or stall the server while registering every folder.
fn allows_recursive_watch(path: &Path, limit: usize) -> bool {
    if path.parent().is_none() || dirs::home_dir().as_deref() == Some(path) { return false; }
    let mut queue = vec![path.to_path_buf()];
    let mut count = 0;
    while let Some(directory) = queue.pop() {
        count += 1;
        if count > limit { return false; }
        let Ok(entries) = std::fs::read_dir(directory) else { continue };
        for entry in entries.flatten() {
            if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                queue.push(entry.path());
                if queue.len() + count > limit { return false; }
            }
        }
    }
    true
}

pub(crate) async fn start_watch_path(
    state: &WebWatchState,
    event_tx: broadcast::Sender<(String, Value)>,
    path: String,
) -> Result<(), String> {
    let abs = expand_path(&path)?;
    if !abs.exists() {
        return Err("Path does not exist".to_string());
    }

    let limit = std::env::var("SESSION_FS_WATCH_MAX_DIRS").ok().and_then(|value| value.parse::<usize>().ok()).filter(|limit| *limit > 0 && *limit <= 65_536).unwrap_or(1024);
    let probe = abs.clone();
    let recursive = abs.is_dir() && tokio::task::spawn_blocking(move || allows_recursive_watch(&probe, limit)).await.map_err(|e| e.to_string())?;
    let recursive_mode = if recursive { RecursiveMode::Recursive } else { RecursiveMode::NonRecursive };

    let key = match std::fs::canonicalize(&abs) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => abs.to_string_lossy().to_string(),
    };

    let mut watchers = state.watchers.lock().await;
    {
        if let Some((_existing, count)) = watchers.get_mut(&key) {
            *count += 1;
            return Ok(());
        }
    }

    let event_tx_for_cb = event_tx.clone();
    let mut watcher: RecommendedWatcher =
        recommended_watcher(move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Access(_)) { return; }
                for p in event.paths.iter() {
                    let payload = json!({
                        "path": p.to_string_lossy().to_string(),
                        "kind": kind_to_string(&event.kind),
                    });
                    let _ = event_tx_for_cb.send(("fs_change".to_string(), payload));
                }
            }
        })
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    watcher
        .watch(&abs, recursive_mode)
        .map_err(|e| format!("Failed to start watcher: {}", e))?;

    watchers.insert(key, (watcher, 1));
    Ok(())
}

pub(crate) async fn unwatch_path(state: &WebWatchState, path: String) -> Result<(), String> {
    let abs = expand_path(&path)?;
    let key = match std::fs::canonicalize(&abs) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(_) => abs.to_string_lossy().to_string(),
    };

    let mut watchers = state.watchers.lock().await;
    if let Some((_, count)) = watchers.get_mut(&key)
        && *count > 1
    {
        *count -= 1;
        return Ok(());
    }
    if let Some((mut watcher, _)) = watchers.remove(&key) {
        let _ = watcher.unwatch(&abs);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_directories_use_bounded_watches() {
        let temp = tempfile::tempdir().unwrap();
        for n in 0..6 { std::fs::create_dir(temp.path().join(n.to_string())).unwrap(); }
        assert!(!allows_recursive_watch(temp.path(), 5));
        assert!(allows_recursive_watch(temp.path(), 10));
    }
    #[tokio::test]
    async fn concurrent_watchers_share_one_reference_count() {
        let temp = tempfile::tempdir().unwrap(); let state = WebWatchState::default();
        let (tx, _) = broadcast::channel(16); let path = temp.path().to_str().unwrap().to_string();
        let (a,b) = tokio::join!(start_watch_path(&state, tx.clone(), path.clone()), start_watch_path(&state, tx, path.clone()));
        a.unwrap(); b.unwrap();
        assert_eq!(state.watchers.lock().await.get(&path).unwrap().1, 2);
        unwatch_path(&state,path.clone()).await.unwrap(); assert_eq!(state.watchers.lock().await.get(&path).unwrap().1,1);
        unwatch_path(&state,path).await.unwrap(); assert!(state.watchers.lock().await.is_empty());
    }
}
