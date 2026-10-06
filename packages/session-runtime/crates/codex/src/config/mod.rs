pub mod mcp;
pub mod provider;
pub mod toml_helpers;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use self::mcp::McpServerConfig;

/// Multi-agent runtime limits, mirrors the upstream `[agents]` TOML section.
/// Defaults align with CodexMonitor conventions:
///   max_threads = 6  (upstream Codex default)
///   max_depth   = 1  (CodexMonitor product default)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentsConfig {
    /// Maximum number of concurrent sub-agent threads (UI cap: 12).
    #[serde(default = "AgentsConfig::default_max_threads")]
    pub max_threads: u32,
    /// Maximum agent spawning depth (UI cap: 4).
    #[serde(default = "AgentsConfig::default_max_depth")]
    pub max_depth: u32,
}

impl AgentsConfig {
    fn default_max_threads() -> u32 {
        6
    }
    fn default_max_depth() -> u32 {
        1
    }
}

impl Default for AgentsConfig {
    fn default() -> Self {
        Self {
            max_threads: Self::default_max_threads(),
            max_depth: Self::default_max_depth(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexConfig {
    #[serde(default)]
    pub mcp_servers: HashMap<String, McpServerConfig>,
    /// Multi-agent runtime configuration parsed from `[agents]`.
    #[serde(default)]
    pub agents: AgentsConfig,
}

pub fn get_config_path() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    Ok(home_dir.join(".codex").join("config.toml"))
}
