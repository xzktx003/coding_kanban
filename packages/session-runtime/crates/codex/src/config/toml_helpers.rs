use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    str::FromStr,
};
use toml_edit::{Document, Table};

pub fn serialize_to_table<T: Serialize>(value: &T) -> Result<Table, String> {
    let serialized =
        toml::to_string(value).map_err(|e| format!("Failed to serialize value: {}", e))?;
    let doc = Document::from_str(&serialized)
        .map_err(|e| format!("Failed to parse serialized value: {}", e))?;
    Ok(doc.as_table().clone())
}

fn make_backup_path(target: &Path) -> PathBuf {
    target.with_extension("toml.bak")
}

pub fn write_document_with_backup(path: &Path, doc: &Document) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }

    let backup_path = if path.exists() {
        let backup = make_backup_path(path);
        fs::copy(path, &backup).map_err(|e| format!("Failed to backup config file: {}", e))?;
        Some(backup)
    } else {
        None
    };

    let content = doc.to_string();
    fs::write(path, content.as_bytes())
        .map_err(|e| format!("Failed to write config file: {}", e))?;

    let written_content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read config file after writing: {}", e))?;

    if let Err(parse_error) = Document::from_str(&written_content) {
        if let Some(ref backup) = backup_path {
            fs::copy(backup, path)
                .map_err(|e| format!("Failed to restore config from backup: {}", e))?;
        }
        return Err(format!(
            "Failed to parse rewritten config file: {}",
            parse_error
        ));
    }

    if let Some(backup) = backup_path {
        fs::remove_file(backup).map_err(|e| format!("Failed to remove config backup: {}", e))?;
    }

    Ok(())
}
