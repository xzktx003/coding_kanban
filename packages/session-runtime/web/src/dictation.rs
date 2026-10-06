use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use axum::{Json, extract::Query, http::StatusCode, response::IntoResponse};
use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

type Downloads = Mutex<HashMap<String, tokio::task::JoinHandle<()>>>;
static DOWNLOADS: OnceLock<Downloads> = OnceLock::new();
static ERRORS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static OPERATIONS: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static INFERENCE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

#[derive(Deserialize)]
pub struct Model { #[serde(default = "default_model", rename = "modelId", alias = "model")] model: String }
fn default_model() -> String { "base".into() }

fn model_path(model: &str) -> Result<PathBuf, String> {
    if !["tiny", "base", "small", "medium", "large-v3"].contains(&model) { return Err("Unsupported dictation model".into()); }
    let home = std::env::var_os("SESSION_DATA_HOME").map(PathBuf::from).ok_or("SESSION_DATA_HOME is required")?;
    Ok(home.join("dictation").join(format!("ggml-{model}.bin")))
}

fn status(model: &str) -> Result<Value, String> {
    let path = model_path(model)?;
    let downloading = DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap().contains_key(model);
    let error = ERRORS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap().get(model).cloned();
    let state = if downloading { "downloading" } else if path.is_file() { "ready" } else if error.is_some() { "error" } else { "missing" };
    let progress = downloading.then(|| json!({"downloadedBytes": std::fs::metadata(path.with_extension("part")).map(|m| m.len()).unwrap_or(0), "totalBytes": Value::Null}));
    Ok(json!({"state": state, "modelId": model, "path": path, "error": error, "progress": progress}))
}

fn failure(error: impl ToString) -> axum::response::Response {
    (StatusCode::BAD_REQUEST, Json(json!({"error": error.to_string()}))).into_response()
}
pub async fn get_status(Query(model): Query<Model>) -> axum::response::Response {
    match status(&model.model) { Ok(value) => Json(value).into_response(), Err(error) => failure(error) }
}

pub async fn download(Json(model): Json<Model>) -> axum::response::Response {
    let _operation = OPERATIONS.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    let path = match model_path(&model.model) { Ok(path) => path, Err(error) => return failure(error) };
    if path.is_file() { return Json(status(&model.model).unwrap()).into_response(); }
    let tasks = DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let mut tasks = tasks.lock().unwrap();
        if !tasks.contains_key(&model.model) {
            let id = model.model.clone();
            ERRORS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap().remove(&id);
            tasks.insert(id.clone(), tokio::spawn(async move {
                if let Err(error) = download_file(&id, &path).await {
                    ERRORS.get().unwrap().lock().unwrap().insert(id.clone(), error);
                    let _ = tokio::fs::remove_file(path.with_extension("part")).await;
                }
                DOWNLOADS.get().unwrap().lock().unwrap().remove(&id);
            }));
        }
    }
    Json(status(&model.model).unwrap()).into_response()
}

async fn download_file(id: &str, path: &PathBuf) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    tokio::fs::create_dir_all(path.parent().unwrap()).await.map_err(|e| e.to_string())?;
    let mut response = reqwest::Client::new().get(format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{id}.bin")).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
    let partial = path.with_extension("part");
    let mut file = tokio::fs::File::create(&partial).await.map_err(|e| e.to_string())?;
    let mut total = 0usize;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        total += chunk.len();
        if total > 4 * 1024 * 1024 * 1024usize { return Err("Model download exceeds size limit".into()); }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    if total < 1024 * 1024 { return Err("Model download is incomplete".into()); }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    tokio::fs::rename(partial, path).await.map_err(|e| e.to_string())
}

pub async fn cancel(Json(model): Json<Model>) -> axum::response::Response {
    let _operation = OPERATIONS.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    let path = match model_path(&model.model) { Ok(path) => path, Err(error) => return failure(error) };
    let task = DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap().remove(&model.model);
    if let Some(task) = task { task.abort(); let _ = task.await; }
    let _ = tokio::fs::remove_file(path.with_extension("part")).await;
    Json(status(&model.model).unwrap()).into_response()
}

pub async fn remove(Json(model): Json<Model>) -> axum::response::Response {
    let _operation = OPERATIONS.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    let path = match model_path(&model.model) { Ok(path) => path, Err(error) => return failure(error) };
    if DOWNLOADS.get_or_init(|| Mutex::new(HashMap::new())).lock().unwrap().contains_key(&model.model) { return failure("Cancel the download before removing the model"); }
    if path.exists() && let Err(error) = tokio::fs::remove_file(path).await { return failure(error); }
    Json(status(&model.model).unwrap()).into_response()
}

#[derive(Deserialize)]
pub struct Audio { #[serde(rename = "modelId")] model: String, data: String, language: Option<String> }
pub async fn transcribe(Json(input): Json<Audio>) -> axum::response::Response {
    let path = match model_path(&input.model) { Ok(path) if path.is_file() => path, _ => return failure("Download the selected dictation model first") };
    let bytes = match base64::engine::general_purpose::STANDARD.decode(&input.data) { Ok(bytes) => bytes, Err(_) => return failure("Invalid PCM audio") };
    if bytes.len() < 6400 || bytes.len() > 3_840_000 || bytes.len() % 2 != 0 { return failure("Audio must be between 0.2 and 120 seconds at 16 kHz mono"); }
    let audio: Vec<f32> = bytes.as_chunks::<2>().0.iter().map(|b| f32::from(i16::from_le_bytes([b[0], b[1]])) / 32768.0).collect();
    let _permit = INFERENCE.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
    let result = tokio::task::spawn_blocking(move || -> Result<String, String> {
        let context = WhisperContext::new_with_params(&path.to_string_lossy(), WhisperContextParameters::default()).map_err(|e| e.to_string())?;
        let mut state = context.create_state().map_err(|e| e.to_string())?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_print_special(false); params.set_print_progress(false); params.set_print_realtime(false); params.set_print_timestamps(false);
        params.set_no_timestamps(true); params.set_translate(false); params.set_no_context(true); params.set_n_threads(4);
        params.set_language(input.language.as_deref().or(Some("auto")));
        state.full(params, &audio).map_err(|e| e.to_string())?;
        let count = state.full_n_segments().map_err(|e| e.to_string())?;
        let mut text = String::new();
        for index in 0..count { text.push_str(&state.full_get_segment_text(index).map_err(|e| e.to_string())?); }
        Ok(text.trim().to_string())
    }).await;
    match result { Ok(Ok(text)) => Json(json!({"text": text})).into_response(), Ok(Err(error)) => failure(error), Err(error) => failure(error) }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_model_path_injection() { assert!(model_path("../../model").is_err()); }
    #[test]
    fn default_model_is_known() { assert_eq!(default_model(), "base"); }
}
