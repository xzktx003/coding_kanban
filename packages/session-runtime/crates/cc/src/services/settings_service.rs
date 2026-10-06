use std::fs;

pub fn get_settings() -> Result<serde_json::Value, String> {
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;
    let settings_path = home.join(".claude").join("settings.json");

    if !settings_path.exists() {
        // Return default settings if file doesn't exist
        return Ok(serde_json::json!({
            "env": {},
            "permissions": {
                "allow": [],
                "deny": []
            },
            "enabledPlugins": {},
            "enabledSkills": {}
        }));
    }

    let content = fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings.json: {}", e))?;

    let settings: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings.json: {}", e))?;

    Ok(settings)
}

pub fn update_settings(settings: serde_json::Value) -> Result<(), String> {
    let home = dirs::home_dir().ok_or("Failed to get home directory")?;
    let claude_dir = home.join(".claude");
    let settings_path = claude_dir.join("settings.json");

    // Create .claude directory if it doesn't exist
    if !claude_dir.exists() {
        fs::create_dir_all(&claude_dir)
            .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
    }

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&settings_path, content)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;

    Ok(())
}
