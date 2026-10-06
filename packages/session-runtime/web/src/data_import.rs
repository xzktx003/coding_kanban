use std::path::{Path, PathBuf};
use axum::{Json, extract::State, http::StatusCode, response::IntoResponse};
use rusqlite::{Connection, OpenFlags, types::Value as SqlValue};
use serde::Deserialize;
use serde_json::{Value, json};
use crate::types::WebServerState;

const TABLES: &[&str] = &["bots", "acp_sessions", "acp_session_updates", "automation_runs", "automation_run_projects", "automation_run_steps", "notes"];
#[derive(Deserialize)]
pub struct ImportSource { source: String }

fn source_dir(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || value.contains('\0') { return Err("Choose an absolute Codexia data directory".into()); }
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.is_dir() { return Err("Data source must be a directory".into()); }
    let target = std::env::var_os("SESSION_DATA_HOME").map(PathBuf::from).ok_or("Application data home unavailable")?.join(".codexia");
    if path == target.canonicalize().unwrap_or(target) { return Err("Source and destination must be different".into()); }
    Ok(path)
}

fn read_workspace(source: &Path) -> Result<Value, String> {
    let path = source.join("settings.json");
    if !path.exists() { return Ok(json!({})); }
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(data.get("workspace").cloned().unwrap_or_else(|| json!({})))
}
fn read_tasks(source: &Path) -> Result<Vec<codexia_automation::AutomationTask>, String> {
    let path = source.join("automations.json");
    if !path.exists() { return Ok(vec![]); }
    let data: Value = serde_json::from_str(&std::fs::read_to_string(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    serde_json::from_value(data.get("tasks").cloned().unwrap_or_else(|| json!([]))).map_err(|e| e.to_string())
}
fn source_database(source: &Path) -> Result<Option<Connection>, String> {
    let path = source.join("cache.db");
    if !path.exists() { return Ok(None); }
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map(Some).map_err(|e| e.to_string())
}
fn has_table(connection: &Connection, table: &str) -> bool {
    connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1", [table], |row| row.get::<_, i64>(0)).unwrap_or(0) > 0
}
fn summary(source: &Path) -> Result<Value, String> {
    let workspace = read_workspace(source)?;
    let tasks = read_tasks(source)?;
    let connection = source_database(source)?;
    let mut counts = serde_json::Map::new();
    for table in TABLES {
        let count = match connection.as_ref() {
            Some(db) if has_table(db, table) => db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get::<_, i64>(0)).map_err(|e| e.to_string())?,
            _ => 0,
        };
        counts.insert((*table).into(), json!(count));
    }
    Ok(json!({"projects": workspace.get("projects").and_then(Value::as_array).map(Vec::len).unwrap_or(0), "tasks": tasks.len(), "records": counts}))
}
fn failure(error: impl ToString) -> axum::response::Response {
    (StatusCode::BAD_REQUEST, Json(json!({"error": error.to_string()}))).into_response()
}
pub async fn preview(Json(input): Json<ImportSource>) -> axum::response::Response {
    let result = source_dir(&input.source).and_then(|source| summary(&source));
    match result { Ok(value) => Json(value).into_response(), Err(error) => failure(error) }
}

fn columns(connection: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})")).map_err(|e| e.to_string())?;
    statement.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
fn import_database(source: &Path, destination: &Path) -> Result<usize, String> {
    let Some(source) = source_database(source)? else { return Ok(0) };
    codexia_db::initialize_application_database()?;
    let mut target = Connection::open(destination.join("cache.db")).map_err(|e| e.to_string())?;
    target.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    let transaction = target.transaction().map_err(|e| e.to_string())?;
    let mut inserted = 0;
    for table in TABLES {
        if !has_table(&source, table) || !has_table(&transaction, table) { continue; }
        let source_columns = columns(&source, table)?;
        let common: Vec<String> = columns(&transaction, table)?.into_iter().filter(|name| source_columns.contains(name) && !(*table == "acp_session_updates" && name == "id")).collect();
        if common.is_empty() || common.iter().any(|name| !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')) { return Err("Unsupported database schema".into()); }
        if *table == "acp_session_updates" && ["session_id", "payload", "created_at"].iter().any(|name| !common.iter().any(|column| column == name)) { return Err("Unsupported ACP transcript schema".into()); }
        let names = common.join(",");
        let placeholders = vec!["?"; common.len()].join(",");
        let mut statement = source.prepare(&format!("SELECT {names} FROM {table}")).map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| (0..common.len()).map(|index| row.get::<_, SqlValue>(index)).collect::<Result<Vec<_>, _>>()).map_err(|e| e.to_string())?;
        for row in rows {
            let row = row.map_err(|e| e.to_string())?;
            if *table == "acp_session_updates" {
                let value = |name: &str| row[common.iter().position(|column| column == name).unwrap()].clone();
                let duplicate = transaction.query_row("SELECT COUNT(*) FROM acp_session_updates WHERE session_id=?1 AND payload=?2 AND created_at=?3", rusqlite::params![value("session_id"), value("payload"), value("created_at")], |row| row.get::<_, i64>(0)).map_err(|e| e.to_string())?;
                if duplicate > 0 { continue; }
            }
            inserted += transaction.execute(&format!("INSERT OR IGNORE INTO {table} ({names}) VALUES ({placeholders})"), rusqlite::params_from_iter(row)).map_err(|e| e.to_string())?;
        }
    }
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(inserted)
}

fn copy_memory(source: &Path, destination: &Path) -> Result<usize, String> {
    let source = source.join("bots");
    if !source.is_dir() { return Ok(0); }
    fn copy_tree(source: &Path, target: &Path, count: &mut usize) -> Result<(), String> {
        std::fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for entry in std::fs::read_dir(source).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() { continue; }
            let target = target.join(entry.file_name());
            if kind.is_dir() { copy_tree(&entry.path(), &target, count)?; }
            else if kind.is_file() && !target.exists() { std::fs::copy(entry.path(), target).map_err(|e| e.to_string())?; *count += 1; }
        }
        Ok(())
    }
    let mut count = 0;
    for entry in std::fs::read_dir(&source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() { continue; }
        let memory = entry.path().join("memory");
        if memory.is_dir() && !memory.is_symlink() { copy_tree(&memory, &destination.join("bots").join(entry.file_name()).join("memory"), &mut count)?; }
    }
    Ok(count)
}

pub async fn apply(State(state): State<WebServerState>, Json(input): Json<ImportSource>) -> axum::response::Response {
    static IMPORT_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = IMPORT_LOCK.lock().await;
    let source = match source_dir(&input.source) { Ok(path) => path, Err(error) => return failure(error) };
    let tasks = match read_tasks(&source) { Ok(tasks) => tasks, Err(error) => return failure(error) };
    let destination = PathBuf::from(std::env::var_os("SESSION_DATA_HOME").unwrap()).join(".codexia");
    let workspace = match read_workspace(&source) { Ok(workspace) => workspace, Err(error) => return failure(error) };
    let source_copy = source.clone(); let target_copy = destination.clone();
    let records = match tokio::task::spawn_blocking(move || import_database(&source_copy, &target_copy)).await { Ok(Ok(count)) => count, Ok(Err(error)) => return failure(error), Err(error) => return failure(error) };
    let mut warnings = Vec::new();
    let tasks = if let Some(automation) = &state.automation {
        match automation.import_paused(tasks).await { Ok(count) => count, Err(error) => { warnings.push(format!("定时任务未导入: {error}")); 0 } }
    } else { 0 };
    let source_copy = source.clone(); let target_copy = destination.clone();
    let memory = match tokio::task::spawn_blocking(move || copy_memory(&source_copy, &target_copy)).await { Ok(Ok(count)) => count, result => { warnings.push(format!("记忆文件未完全导入: {result:?}")); 0 } };
    // Workspace preferences are merged explicitly; native account tokens and
    // device pairing capabilities are never included in this import.
    let settings_path = destination.join("settings.json");
    let mut current: Value = std::fs::read_to_string(&settings_path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_else(|| json!({"version": 1}));
    let mut projects: Vec<String> = current.pointer("/workspace/projects").and_then(Value::as_array).map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    if let Some(items) = workspace.get("projects").and_then(Value::as_array) { for item in items { if let Some(path) = item.as_str() && Path::new(path).is_absolute() && !projects.iter().any(|p| p == path) { projects.push(path.into()); } } }
    if !current.get("workspace").is_some_and(Value::is_object) { current["workspace"] = json!({}); }
    current["workspace"]["projects"] = json!(projects);
    let mut history = current.pointer("/workspace/historyProjects").and_then(Value::as_array).cloned().unwrap_or_default();
    for item in workspace.get("historyProjects").and_then(Value::as_array).into_iter().flatten() {
        if item.as_str().is_some_and(|path| Path::new(path).is_absolute()) && !history.contains(item) { history.push(item.clone()); }
    }
    current["workspace"]["historyProjects"] = json!(history);
    let temp = settings_path.with_extension("import.tmp");
    if let Err(error) = std::fs::write(&temp, serde_json::to_vec_pretty(&current).unwrap()).and_then(|_| std::fs::rename(temp, settings_path)) { warnings.push(format!("项目设置未导入: {error}")); }
    Json(json!({"projects": projects.len(), "records": records, "tasks": tasks, "memoryFiles": memory, "warnings": warnings})).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_relative_sources() { assert!(source_dir("../.codexia").is_err()); }
    #[test]
    fn workspace_import_does_not_include_account_credentials() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), r#"{"workspace":{"projects":["/project"]},"remote":{"token":"private"}}"#).unwrap();
        assert_eq!(read_workspace(dir.path()).unwrap(), json!({"projects":["/project"]}));
    }
}
