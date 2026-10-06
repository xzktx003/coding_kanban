use chrono::{DateTime, Utc};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::get_connection;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub user_id: Option<String>,
    pub title: String,
    pub content: String,
    pub tags: Option<Vec<String>>,
    pub is_favorited: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub synced_at: Option<DateTime<Utc>>,
}

/// Create a new note
pub fn create_note(
    id: String,
    user_id: Option<String>,
    title: String,
    content: String,
    tags: Option<Vec<String>>,
) -> Result<Note, String> {
    let conn = get_connection()?;
    let now = Utc::now();

    let tags_json = tags
        .as_ref()
        .map(|t| serde_json::to_string(t).unwrap_or_default());

    conn.execute(
        "INSERT INTO notes (id, user_id, title, content, tags, is_favorited, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            user_id,
            title,
            content,
            tags_json,
            false,
            now.to_rfc3339(),
            now.to_rfc3339()
        ],
    )
    .map_err(|e| format!("Failed to create note: {}", e))?;

    Ok(Note {
        id,
        user_id,
        title,
        content,
        tags,
        is_favorited: false,
        created_at: now,
        updated_at: now,
        synced_at: None,
    })
}

/// Get all notes for a user (or all if user_id is None)
pub fn get_notes(user_id: Option<String>) -> Result<Vec<Note>, String> {
    let conn = get_connection()?;

    let query = if user_id.is_some() {
        "SELECT id, user_id, title, content, tags, is_favorited, created_at, updated_at, synced_at
         FROM notes WHERE user_id = ?1 OR user_id IS NULL
         ORDER BY updated_at DESC"
    } else {
        "SELECT id, user_id, title, content, tags, is_favorited, created_at, updated_at, synced_at
         FROM notes WHERE user_id IS NULL
         ORDER BY updated_at DESC"
    };

    let mut stmt = conn
        .prepare(query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let notes: Result<Vec<Note>, String> = if let Some(uid) = user_id {
        stmt.query_map(params![uid], parse_note_row)
    } else {
        stmt.query_map([], parse_note_row)
    }
    .map_err(|e| format!("Failed to query notes: {}", e))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("Failed to collect notes: {}", e));

    notes
}

/// Get a single note by ID
pub fn get_note_by_id(id: String) -> Result<Option<Note>, String> {
    let conn = get_connection()?;

    let mut stmt = conn
        .prepare(
            "SELECT id, user_id, title, content, tags, is_favorited, created_at, updated_at, synced_at
             FROM notes WHERE id = ?1"
        )
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let note = stmt
        .query_row(params![id], parse_note_row)
        .optional()
        .map_err(|e| format!("Failed to query note: {}", e))?;

    Ok(note)
}

/// Update a note
pub fn update_note(
    id: String,
    title: Option<String>,
    content: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    let conn = get_connection()?;
    let now = Utc::now();

    let mut updates = Vec::new();
    let mut params_list: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(t) = title {
        updates.push("title = ?");
        params_list.push(Box::new(t));
    }
    if let Some(c) = content {
        updates.push("content = ?");
        params_list.push(Box::new(c));
    }
    if let Some(t) = tags {
        updates.push("tags = ?");
        let tags_json = serde_json::to_string(&t).unwrap_or_default();
        params_list.push(Box::new(tags_json));
    }

    if updates.is_empty() {
        return Ok(());
    }

    updates.push("updated_at = ?");
    params_list.push(Box::new(now.to_rfc3339()));

    updates.push("synced_at = NULL");

    params_list.push(Box::new(id));

    let query = format!("UPDATE notes SET {} WHERE id = ?", updates.join(", "));

    let params_refs: Vec<&dyn rusqlite::ToSql> = params_list.iter().map(|b| b.as_ref()).collect();

    conn.execute(&query, params_refs.as_slice())
        .map_err(|e| format!("Failed to update note: {}", e))?;

    Ok(())
}

/// Delete a note
pub fn delete_note(id: String) -> Result<(), String> {
    let conn = get_connection()?;

    conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
        .map_err(|e| format!("Failed to delete note: {}", e))?;

    Ok(())
}

/// Toggle favorite status
pub fn toggle_favorite(id: String) -> Result<(), String> {
    let conn = get_connection()?;
    let now = Utc::now();

    conn.execute(
        "UPDATE notes SET is_favorited = NOT is_favorited, updated_at = ?1, synced_at = NULL WHERE id = ?2",
        params![now.to_rfc3339(), id],
    )
    .map_err(|e| format!("Failed to toggle favorite: {}", e))?;

    Ok(())
}

/// Mark notes as synced
pub fn mark_notes_synced(ids: Vec<String>) -> Result<(), String> {
    let conn = get_connection()?;
    let now = Utc::now();

    for id in ids {
        conn.execute(
            "UPDATE notes SET synced_at = ?1 WHERE id = ?2",
            params![now.to_rfc3339(), id],
        )
        .map_err(|e| format!("Failed to mark note as synced: {}", e))?;
    }

    Ok(())
}

/// Get unsynced notes (for future sync functionality)
pub fn get_unsynced_notes(user_id: Option<String>) -> Result<Vec<Note>, String> {
    let conn = get_connection()?;

    let query = if user_id.is_some() {
        "SELECT id, user_id, title, content, tags, is_favorited, created_at, updated_at, synced_at
         FROM notes
         WHERE (user_id = ?1 OR user_id IS NULL) AND (synced_at IS NULL OR updated_at > synced_at)
         ORDER BY updated_at DESC"
    } else {
        "SELECT id, user_id, title, content, tags, is_favorited, created_at, updated_at, synced_at
         FROM notes
         WHERE user_id IS NULL AND (synced_at IS NULL OR updated_at > synced_at)
         ORDER BY updated_at DESC"
    };

    let mut stmt = conn
        .prepare(query)
        .map_err(|e| format!("Failed to prepare query: {}", e))?;

    let notes: Result<Vec<Note>, String> = if let Some(uid) = user_id {
        stmt.query_map(params![uid], parse_note_row)
    } else {
        stmt.query_map([], parse_note_row)
    }
    .map_err(|e| format!("Failed to query unsynced notes: {}", e))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| format!("Failed to collect unsynced notes: {}", e));

    notes
}

/// Helper function to parse a note row
fn parse_note_row(row: &rusqlite::Row) -> Result<Note, rusqlite::Error> {
    let id: String = row.get(0)?;
    let user_id: Option<String> = row.get(1)?;
    let title: String = row.get(2)?;
    let content: String = row.get(3)?;
    let tags_json: Option<String> = row.get(4)?;
    let is_favorited: bool = row.get(5)?;
    let created_at_str: String = row.get(6)?;
    let updated_at_str: String = row.get(7)?;
    let synced_at_str: Option<String> = row.get(8)?;

    let tags = tags_json.and_then(|json| serde_json::from_str(&json).ok());

    let created_at = DateTime::parse_from_rfc3339(&created_at_str)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    let updated_at = DateTime::parse_from_rfc3339(&updated_at_str)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    let synced_at = synced_at_str.and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .map(|dt| dt.with_timezone(&Utc))
            .ok()
    });

    Ok(Note {
        id,
        user_id,
        title,
        content,
        tags,
        is_favorited,
        created_at,
        updated_at,
        synced_at,
    })
}
