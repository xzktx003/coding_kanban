use std::fs;
use std::path::PathBuf;

const SETTINGS_FILE: &str = ".claude/settings.json";

fn read_settings(path: &PathBuf) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}

/// Appends `tool_name` to the `permissions.allow` list in `{cwd}/.claude/settings.json`.
/// Creates the file and intermediate directories if they don't exist.
pub fn add_project_allow_rule(cwd: &str, tool_name: &str) -> Result<(), String> {
    let settings_path = PathBuf::from(cwd).join(SETTINGS_FILE);

    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut settings = read_settings(&settings_path)?;

    if !settings.is_object() {
        settings = serde_json::json!({});
    }

    {
        let root = settings.as_object_mut().unwrap();

        let permissions = root
            .entry("permissions")
            .or_insert_with(|| serde_json::json!({}));

        if !permissions.is_object() {
            *permissions = serde_json::json!({});
        }

        let perm_obj = permissions.as_object_mut().unwrap();

        let allow = perm_obj
            .entry("allow")
            .or_insert_with(|| serde_json::json!([]));

        if !allow.is_array() {
            *allow = serde_json::json!([]);
        }

        let allow_arr = allow.as_array_mut().unwrap();
        let rule = serde_json::Value::String(tool_name.to_string());
        if !allow_arr.contains(&rule) {
            allow_arr.push(rule);
        }
    }

    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&settings_path, content).map_err(|e| e.to_string())?;

    log::info!(
        "[permission_storage] Added '{}' to project allow rules at {:?}",
        tool_name,
        settings_path
    );
    Ok(())
}
