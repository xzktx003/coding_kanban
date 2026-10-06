use super::to_error_response;
use axum::{Json, extract::State as AxumState, http::StatusCode};
use serde::Deserialize;

use crate::terminal as web_terminal;
use crate::types::{ErrorResponse, WebServerState};
use codexia_shared::terminal::TerminalStartResponse;

#[derive(Deserialize)]
pub(crate) struct TerminalStartParams {
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Deserialize)]
pub(crate) struct TerminalSessionParams {
    #[serde(rename = "session_id", alias = "sessionId")]
    session_id: String,
}

#[derive(Deserialize)]
pub(crate) struct TerminalWriteParams {
    #[serde(rename = "session_id", alias = "sessionId")]
    session_id: String,
    data: String,
}

#[derive(Deserialize)]
pub(crate) struct TerminalResizeParams {
    #[serde(rename = "session_id", alias = "sessionId")]
    session_id: String,
    cols: u16,
    rows: u16,
}
pub(crate) async fn api_terminal_start(
    AxumState(state): AxumState<WebServerState>,
    Json(params): Json<TerminalStartParams>,
) -> Result<Json<TerminalStartResponse>, ErrorResponse> {
    let response = web_terminal::terminal_start(
        state.terminal_state.as_ref(),
        state.event_tx.clone(),
        params.cwd,
        params.cols,
        params.rows,
    )
    .await
    .map_err(to_error_response)?;
    Ok(Json(response))
}

pub(crate) async fn api_terminal_write(
    AxumState(state): AxumState<WebServerState>,
    Json(params): Json<TerminalWriteParams>,
) -> Result<StatusCode, ErrorResponse> {
    web_terminal::terminal_write(state.terminal_state.as_ref(), params.session_id, params.data)
        .await
        .map_err(to_error_response)?;
    Ok(StatusCode::OK)
}

pub(crate) async fn api_terminal_resize(
    AxumState(state): AxumState<WebServerState>,
    Json(params): Json<TerminalResizeParams>,
) -> Result<StatusCode, ErrorResponse> {
    web_terminal::terminal_resize(
        state.terminal_state.as_ref(),
        params.session_id,
        params.cols,
        params.rows,
    )
    .await
    .map_err(to_error_response)?;
    Ok(StatusCode::OK)
}

pub(crate) async fn api_terminal_stop(
    AxumState(state): AxumState<WebServerState>,
    Json(params): Json<TerminalSessionParams>,
) -> Result<StatusCode, ErrorResponse> {
    web_terminal::terminal_stop(state.terminal_state.as_ref(), params.session_id)
        .await
        .map_err(to_error_response)?;
    Ok(StatusCode::OK)
}
