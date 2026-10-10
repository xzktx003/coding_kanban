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
    let codex_home = std::env::var("CODEX_HOME").ok();
    if codex_home.as_deref().is_some_and(|path| !path.is_empty()) {
        return config_path_for_roots(codex_home.as_deref(), PathBuf::new());
    }
    let home_dir = dirs::home_dir().ok_or("Could not find home directory")?;
    config_path_for_roots(None, home_dir)
}

fn config_path_for_roots(codex_home: Option<&str>, home_dir: PathBuf) -> Result<PathBuf, String> {
    match codex_home.filter(|path| !path.is_empty()) {
        Some(path) => {
            // Match the native CLI: an explicit home must exist, be a directory,
            // and resolve to its canonical location before config is accessed.
            let directory = PathBuf::from(path)
                .canonicalize()
                .map_err(|error| format!("Could not resolve CODEX_HOME: {}", error))?;
            if !directory.is_dir() {
                return Err("CODEX_HOME must be a directory".to_string());
            }
            Ok(directory.join("config.toml"))
        }
        None => Ok(home_dir.join(".codex").join("config.toml")),
    }
}

#[cfg(test)]
mod config_owner_tests {
    use super::*;

    struct TestRoot(PathBuf);
    impl TestRoot {
        fn new() -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "coding-kanban-config-owner-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn explicit_native_home_selects_the_same_config_directory() {
        let root = TestRoot::new();
        let native = root.0.join("native-home");
        std::fs::create_dir(&native).unwrap();
        assert_eq!(
            config_path_for_roots(native.to_str(), root.0.join("unrelated-home")).unwrap(),
            native.canonicalize().unwrap().join("config.toml")
        );
    }

    #[test]
    fn invalid_native_home_is_rejected_instead_of_writing_default_home() {
        let root = TestRoot::new();
        let missing = root.0.join("missing");
        assert!(config_path_for_roots(missing.to_str(), root.0.clone()).is_err());
        let file = root.0.join("file");
        std::fs::write(&file, "test marker").unwrap();
        assert!(config_path_for_roots(file.to_str(), root.0.clone()).is_err());
    }

    #[test]
    fn empty_override_retains_the_default_config_path() {
        let root = TestRoot::new();
        assert_eq!(
            config_path_for_roots(Some(""), root.0.clone()).unwrap(),
            root.0.join(".codex/config.toml")
        );
        assert_eq!(
            config_path_for_roots(None, root.0.clone()).unwrap(),
            root.0.join(".codex/config.toml")
        );
    }

    #[cfg(unix)]
    #[test]
    fn native_home_symlink_uses_its_canonical_directory() {
        let root = TestRoot::new();
        let actual = root.0.join("actual");
        let alias = root.0.join("alias");
        std::fs::create_dir(&actual).unwrap();
        std::os::unix::fs::symlink(&actual, &alias).unwrap();
        assert_eq!(
            config_path_for_roots(alias.to_str(), root.0.clone()).unwrap(),
            actual.canonicalize().unwrap().join("config.toml")
        );
    }
}
