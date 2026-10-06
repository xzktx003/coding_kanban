use codexia_shared::terminal::{
    TerminalDataPayload, TerminalExitPayload, TerminalSession, TerminalStartResponse,
    TerminalState, build_shell_command, create_pty_pair, kill_terminal, read_pty_output,
    resize_terminal, spawn_shell, write_terminal,
};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::broadcast;
use uuid::Uuid;

/// Type alias for backward compatibility with existing code
pub type WebTerminalState = TerminalState;

pub(crate) async fn terminal_start(
    state: &TerminalState,
    event_tx: broadcast::Sender<(String, Value)>,
    cwd: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<TerminalStartResponse, String> {
    let pair = create_pty_pair(cols.unwrap_or(120), rows.unwrap_or(30))?;

    let session_id = Uuid::new_v4().to_string();
    let (shell, command) = build_shell_command(cwd);

    let mut slave = pair.slave;
    let child = spawn_shell(&mut *slave, command)?;
    drop(slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| format!("Failed to clone PTY reader: {err}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| format!("Failed to get PTY writer: {err}"))?;

    let session = Arc::new(TerminalSession {
        master: std::sync::Mutex::new(pair.master),
        writer: std::sync::Mutex::new(writer),
        child: std::sync::Mutex::new(child),
    });

    {
        let mut sessions = state.sessions.lock().await;
        sessions.insert(session_id.clone(), Arc::clone(&session));
    }

    let session_id_for_output = session_id.clone();
    let event_tx = event_tx.clone();
    std::thread::spawn(move || {
        let session_id_for_exit = session_id_for_output.clone();
        let event_tx_for_exit = event_tx.clone();
        read_pty_output(reader, move |data| {
            let payload = TerminalDataPayload {
                session_id: session_id_for_output.clone(),
                data,
            };
            let _ = event_tx.send(("terminal:data".to_string(), serde_json::to_value(payload).unwrap()));
        });

        let _ = event_tx_for_exit.send((
            "terminal:exit".to_string(),
            serde_json::to_value(TerminalExitPayload {
                session_id: session_id_for_exit,
                message: "terminal closed".to_string(),
            })
            .unwrap(),
        ));
    });

    Ok(TerminalStartResponse { session_id, shell })
}

pub(crate) async fn terminal_write(
    state: &TerminalState,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions.get(&session_id).cloned()
    }
    .ok_or_else(|| "Terminal session not found".to_string())?;

    write_terminal(&session.writer, &data)
}

pub(crate) async fn terminal_resize(
    state: &TerminalState,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions.get(&session_id).cloned()
    }
    .ok_or_else(|| "Terminal session not found".to_string())?;

    resize_terminal(&session.master, cols, rows)
}

pub(crate) async fn terminal_stop(state: &TerminalState, session_id: String) -> Result<(), String> {
    let session = {
        let mut sessions = state.sessions.lock().await;
        sessions.remove(&session_id)
    }
    .ok_or_else(|| "Terminal session not found".to_string())?;

    kill_terminal(&session.child)
}
