mod conn;
pub mod acp_sessions;
pub mod automation_runs;
pub mod bots;
pub mod notes;

pub(crate) use conn::get_connection;
pub use notes::*;

/// Initializes the application schema before an explicit data import.
pub fn initialize_application_database() -> Result<(), String> { conn::get_connection().map(|_| ()) }
