use gix::bstr::{BString, ByteSlice};
use std::fs;
use std::io::ErrorKind;
use std::path::Path;

use crate::helpers::{
    entry_from_tree, open_repo, remove_all_entries_for_path, stat_for_worktree_path, to_repo_relative_path,
};

pub fn git_stage_files(cwd: String, file_paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&cwd)?;
    let (mut pipeline, index_handle) = repo
        .filter_pipeline(None)
        .map_err(|err| format!("Failed to initialize git filter pipeline: {err}"))?;
    let mut index = index_handle.into_owned();

    for path in &file_paths {
        let relative_path = to_repo_relative_path(&repo, path)?;
        let path_bstring = BString::from(relative_path.as_str());
        let path_bstr = path_bstring.as_ref();

        remove_all_entries_for_path(&mut index, path_bstr);

        let staged = pipeline
            .worktree_file_to_object(path_bstr, &index)
            .map_err(|err| format!("Failed to stage {relative_path}: {err}"))?;

        if let Some((object_id, entry_kind, _)) = staged {
            let mode = gix::index::entry::Mode::from(entry_kind);
            let flags =
                gix::index::entry::Flags::from_stage(gix::index::entry::Stage::Unconflicted);
            let stat = stat_for_worktree_path(&repo, &relative_path);
            index.dangerously_push_entry(stat, object_id, flags, mode, path_bstr);
        }
    }

    index.sort_entries();
    let _ = index.remove_tree();
    let _ = index.remove_resolve_undo();
    index
        .write(Default::default())
        .map_err(|err| format!("Failed to write git index: {err}"))?;
    Ok(())
}

pub fn git_unstage_files(cwd: String, file_paths: Vec<String>) -> Result<(), String> {
    let repo = open_repo(&cwd)?;
    let mut index = {
        let shared = repo
            .index_or_empty()
            .map_err(|err| format!("Failed to load git index: {err}"))?;
        gix::index::File::clone(&shared)
    };
    for path in &file_paths {
        let relative_path = to_repo_relative_path(&repo, path)?;
        let path_bstring = BString::from(relative_path.as_str());
        let path_bstr = path_bstring.as_ref();

        remove_all_entries_for_path(&mut index, path_bstr);

        let Some((object_id, entry_mode)) = entry_from_tree(&repo, &relative_path)? else {
            continue;
        };

        let mode = gix::index::entry::Mode::from(entry_mode);
        let flags = gix::index::entry::Flags::from_stage(gix::index::entry::Stage::Unconflicted);
        index.dangerously_push_entry(
            gix::index::entry::Stat::default(),
            object_id,
            flags,
            mode,
            path_bstr,
        );
    }

    index.sort_entries();
    let _ = index.remove_tree();
    let _ = index.remove_resolve_undo();
    index
        .write(Default::default())
        .map_err(|err| format!("Failed to write git index: {err}"))?;
    Ok(())
}

pub fn git_reverse_files(cwd: String, file_paths: Vec<String>, staged: bool) -> Result<(), String> {
    if staged {
        return git_unstage_files(cwd, file_paths);
    }

    let repo = open_repo(&cwd)?;
    let workdir = repo
        .workdir()
        .ok_or_else(|| "This git repository has no worktree".to_string())?
        .to_path_buf();
    let index = repo
        .index_or_empty()
        .map_err(|err| format!("Failed to load git index: {err}"))?;

    for path in &file_paths {
        let relative_path = to_repo_relative_path(&repo, path)?;
        let entry = index.entry_by_path_and_stage(
            relative_path.as_bytes().as_bstr(),
            gix::index::entry::Stage::Unconflicted,
        );

        if let Some(entry) = entry {
            write_worktree_file_from_index(&repo, &workdir, &relative_path, entry.id.to_owned())?;
        } else {
            remove_worktree_path(&workdir.join(&relative_path))?;
        }
    }

    Ok(())
}

fn write_worktree_file_from_index(
    repo: &gix::Repository,
    workdir: &Path,
    relative_path: &str,
    object_id: gix::hash::ObjectId,
) -> Result<(), String> {
    let absolute_path = workdir.join(relative_path);
    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create parent directories: {err}"))?;
    }

    if absolute_path.is_dir() {
        fs::remove_dir_all(&absolute_path)
            .map_err(|err| format!("Failed to remove directory at restore path: {err}"))?;
    }

    let object = repo
        .find_object(object_id)
        .map_err(|err| format!("Failed to read git object: {err}"))?;
    if object.kind != gix::object::Kind::Blob {
        return Err(format!(
            "Cannot restore non-blob object for path {}",
            relative_path
        ));
    }

    fs::write(&absolute_path, &object.data)
        .map_err(|err| format!("Failed to write restored file: {err}"))?;
    Ok(())
}

fn remove_worktree_path(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.is_dir() {
                fs::remove_dir_all(path).map_err(|err| {
                    format!("Failed to remove untracked directory {}: {err}", path.display())
                })?;
            } else {
                fs::remove_file(path).map_err(|err| {
                    format!("Failed to remove untracked file {}: {err}", path.display())
                })?;
            }
            Ok(())
        }
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "Failed to inspect worktree path {}: {err}",
            path.display()
        )),
    }
}
