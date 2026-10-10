use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

fn plugins_root_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(home.join(".agents").join("plugins"))
}

pub(crate) fn central_skills_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
    let home = home
        .canonicalize()
        .map_err(|error| format!("Failed to resolve home directory: {}", error))?;
    Ok(home.join(".agents").join("skills"))
}

pub(crate) fn validate_skill_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 255
        || name == "."
        || name == ".."
        || name
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\' | ':'))
        || Path::new(name).is_absolute()
    {
        return Err("skill_name must be a single directory name".to_string());
    }
    Ok(name)
}

fn check_skills_root(root: &Path, create: bool) -> Result<(), String> {
    if !root.is_absolute()
        || root
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("Skills root must be an absolute directory".to_string());
    }
    // The selected home/cwd is canonicalized before constructing its managed
    // suffix. Refuse redirects in that suffix, including a symlinked parent.
    let mut ancestors = root.ancestors().collect::<Vec<_>>();
    ancestors.reverse();
    for path in ancestors {
        match std::fs::symlink_metadata(path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Skills root cannot contain a symlink: {}",
                    path.display()
                ));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(format!(
                    "Skills root is not a directory: {}",
                    path.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if create {
                    std::fs::create_dir(path).map_err(|error| {
                        format!(
                            "Failed to create skills directory {}: {}",
                            path.display(),
                            error
                        )
                    })?;
                }
            }
            Err(error) => {
                return Err(format!(
                    "Failed to inspect skills directory {}: {}",
                    path.display(),
                    error
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn managed_skill_path(
    root: &Path,
    name: &str,
    create_root: bool,
) -> Result<PathBuf, String> {
    let name = validate_skill_name(name)?;
    check_skills_root(root, create_root)?;
    Ok(root.join(name))
}

pub(crate) fn existing_managed_skill(root: &Path, name: &str) -> Result<PathBuf, String> {
    let path = managed_skill_path(root, name, false)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Failed to resolve skills root: {}", error))?;
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Skill '{}' not found in central store: {}", name, error))?;
    if !canonical.starts_with(&canonical_root) || canonical == canonical_root || !canonical.is_dir()
    {
        return Err(format!("Skill '{}' leaves its central store", name));
    }
    Ok(canonical)
}

pub(crate) fn validate_skill_source_tree(source: &Path, scope: &Path) -> Result<(), String> {
    fn visit(
        path: &Path,
        scope: &Path,
        active: &mut std::collections::HashSet<PathBuf>,
    ) -> Result<(), String> {
        let canonical = path.canonicalize().map_err(|error| {
            format!(
                "Failed to resolve skill source {}: {}",
                path.display(),
                error
            )
        })?;
        if !canonical.starts_with(scope) {
            return Err(format!(
                "Skill source leaves the cloned repository: {}",
                path.display()
            ));
        }
        if canonical.is_dir() {
            if !active.insert(canonical.clone()) {
                return Err(format!(
                    "Skill source contains a directory link cycle: {}",
                    path.display()
                ));
            }
            for entry in std::fs::read_dir(path)
                .map_err(|error| format!("Failed to read skill source: {}", error))?
            {
                visit(
                    &entry.map_err(|error| error.to_string())?.path(),
                    scope,
                    active,
                )?;
            }
            active.remove(&canonical);
        } else if !canonical.is_file() {
            return Err(format!(
                "Skill source is not a file or directory: {}",
                path.display()
            ));
        }
        Ok(())
    }
    let scope = scope
        .canonicalize()
        .map_err(|error| format!("Failed to resolve cloned repository: {}", error))?;
    visit(source, &scope, &mut std::collections::HashSet::new())
}

pub(crate) fn resolve_skills_install_root(
    selected_agent: &str,
    scope: &str,
    cwd: Option<&str>,
) -> Result<PathBuf, String> {
    let normalized_agent = selected_agent.trim().to_ascii_lowercase();
    if normalized_agent != "codex" && normalized_agent != "cc" {
        return Err(format!("Unsupported selected_agent: {}", selected_agent));
    }

    let normalized_scope = scope.trim().to_ascii_lowercase();
    if normalized_scope != "user" && normalized_scope != "project" {
        return Err(format!("Unsupported scope: {}", scope));
    }

    match (normalized_agent.as_str(), normalized_scope.as_str()) {
        ("codex", "user") => {
            if let Some(path) = std::env::var("CODEX_HOME")
                .ok()
                .filter(|path| !path.is_empty())
            {
                let root = PathBuf::from(path)
                    .canonicalize()
                    .map_err(|error| format!("Failed to resolve CODEX_HOME: {}", error))?;
                if !root.is_dir() {
                    return Err("CODEX_HOME must be a directory".to_string());
                }
                Ok(root.join("skills"))
            } else {
                let home = dirs::home_dir()
                    .ok_or_else(|| "Failed to resolve home directory".to_string())?;
                Ok(home
                    .canonicalize()
                    .map_err(|error| error.to_string())?
                    .join(".codex/skills"))
            }
        }
        ("codex", "project") => {
            let working_dir = cwd
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "cwd is required when scope is project".to_string())?;
            project_skills_root(working_dir, ".codex")
        }
        ("cc", "user") => {
            let home =
                dirs::home_dir().ok_or_else(|| "Failed to resolve home directory".to_string())?;
            Ok(home
                .canonicalize()
                .map_err(|error| error.to_string())?
                .join(".claude")
                .join("skills"))
        }
        ("cc", "project") => {
            let working_dir = cwd
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "cwd is required when scope is project".to_string())?;
            project_skills_root(working_dir, ".claude")
        }
        _ => Err("Failed to resolve install root".to_string()),
    }
}

fn project_skills_root(cwd: &str, agent_directory: &str) -> Result<PathBuf, String> {
    let path = Path::new(cwd);
    if !path.is_absolute() {
        return Err("cwd must be an absolute directory".to_string());
    }
    let path = path
        .canonicalize()
        .map_err(|error| format!("Failed to resolve cwd: {}", error))?;
    if !path.is_dir() {
        return Err("cwd must be a directory".to_string());
    }
    Ok(path.join(agent_directory).join("skills"))
}

fn ensure_plugins_root(target: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|err| {
        format!(
            "Failed to create plugins root directory {}: {}",
            target.display(),
            err
        )
    })
}

fn repo_subpath_from_url(url: &str) -> Result<PathBuf, String> {
    let trimmed = url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Invalid repository url".to_string());
    }

    let path_part = if let Some((_, rest)) = trimmed.split_once("://") {
        rest.split_once('/').map(|(_, path)| path).unwrap_or("")
    } else if let Some((_, rest)) = trimmed.split_once(':') {
        rest
    } else {
        trimmed
    };

    let segments = path_part
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    if segments.is_empty() {
        return Err("Could not derive repository name from url".to_string());
    }

    let repo = segments
        .last()
        .ok_or_else(|| "Could not derive repository name from url".to_string())?
        .trim_end_matches(".git");

    if repo.is_empty() {
        return Err("Could not derive repository name from url".to_string());
    }

    if segments.len() >= 2 {
        let owner = segments[segments.len() - 2];
        if !owner.is_empty() {
            return Ok(PathBuf::from(owner).join(repo));
        }
    }

    Ok(PathBuf::from(repo))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketplaceSkill {
    pub name: String,
    pub description: Option<String>,
    pub license: Option<String>,
    pub skill_md_path: String,
    pub source_dir_path: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledSkill {
    pub name: String,
    pub path: String,
    pub skill_md_path: Option<String>,
    pub description: Option<String>,
}

/// A skill that lives in the central store (~/.agents/skills/).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CentralSkill {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
    /// Whether a link exists in the codex agent skills directory.
    pub linked_codex: bool,
    /// Whether a link exists in the cc agent skills directory.
    pub linked_cc: bool,
}

#[derive(Debug, Default)]
pub(crate) struct SkillFrontMatter {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) license: Option<String>,
}

fn parse_field(line: &str, key: &str) -> Option<Option<String>> {
    let trimmed = line.trim();
    let lower = trimmed.to_lowercase();
    if lower == key {
        return Some(Some(String::new()));
    }
    if !lower.starts_with(&(key.to_string() + ":")) {
        return None;
    }
    let (_, value) = trimmed.split_once(':').unwrap_or((trimmed, ""));
    let parsed = value.trim().trim_matches('"').trim_matches('\'');
    if parsed.is_empty() {
        return Some(Some(String::new()));
    }
    Some(Some(parsed.to_string()))
}

pub(crate) fn parse_skill_front_matter(path: &std::path::Path) -> Result<SkillFrontMatter, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|err| format!("Failed to read {}: {}", path.display(), err))?;
    let mut front_matter = SkillFrontMatter::default();
    for line in content.lines().take(5) {
        if front_matter.name.is_none()
            && let Some(value) = parse_field(line, "name")
        {
            front_matter.name = value;
            continue;
        }
        if front_matter.description.is_none()
            && let Some(value) = parse_field(line, "description")
        {
            front_matter.description = value;
            continue;
        }
        if front_matter.license.is_none()
            && let Some(value) = parse_field(line, "license")
        {
            front_matter.license = value;
            continue;
        }
    }
    Ok(front_matter)
}

fn path_contains_skills_segment(path: &std::path::Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case("skills")
    })
}

fn collect_skill_md_files(dir: &std::path::Path, output: &mut Vec<PathBuf>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(dir)
        .map_err(|err| format!("Failed to read directory {}: {}", dir.display(), err))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read directory entry: {}", err))?;
        let path = entry.path();
        if path.is_dir() {
            collect_skill_md_files(&path, output)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let filename_matches = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case("SKILL.md"))
            .unwrap_or(false);
        if filename_matches && path_contains_skills_segment(&path) {
            output.push(path);
        }
    }
    Ok(())
}

fn scan_marketplace_skills() -> Result<Vec<MarketplaceSkill>, String> {
    let plugins_root = plugins_root_dir()?;
    if !plugins_root.exists() {
        return Ok(Vec::new());
    }
    // Check installed state against the central store, not a specific agent dir.
    let central_dir = central_skills_dir()?;

    let mut skill_files = Vec::new();
    collect_skill_md_files(&plugins_root, &mut skill_files)?;

    let mut skills = Vec::new();
    for skill_md in skill_files {
        let source_dir = match skill_md.parent() {
            Some(dir) => dir,
            None => continue,
        };
        let front_matter = parse_skill_front_matter(&skill_md)?;
        let fallback_name = source_dir
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let resolved_name = front_matter.name.unwrap_or(fallback_name);
        if resolved_name.is_empty() {
            continue;
        }
        let installed = central_dir.join(&resolved_name).join("SKILL.md").is_file();
        skills.push(MarketplaceSkill {
            name: resolved_name,
            description: front_matter.description.filter(|value| !value.is_empty()),
            license: front_matter.license.filter(|value| !value.is_empty()),
            skill_md_path: skill_md.to_string_lossy().to_string(),
            source_dir_path: source_dir.to_string_lossy().to_string(),
            installed,
        });
    }

    skills.sort_by_key(|a| a.name.to_lowercase());
    Ok(skills)
}

fn scan_installed_skills(install_root: &Path) -> Result<Vec<InstalledSkill>, String> {
    if !install_root.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(install_root).map_err(|err| {
        format!(
            "Failed to read directory {}: {}",
            install_root.display(),
            err
        )
    })?;

    let mut skills = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read directory entry: {}", err))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if name.is_empty() {
            continue;
        }
        let skill_md = path.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let front_matter = parse_skill_front_matter(&skill_md)?;
        let skill_md_path = Some(skill_md.to_string_lossy().to_string());
        let description = front_matter.description.filter(|value| !value.is_empty());

        skills.push(InstalledSkill {
            name,
            path: path.to_string_lossy().to_string(),
            skill_md_path,
            description,
        });
    }
    skills.sort_by_key(|a| a.name.to_lowercase());
    Ok(skills)
}

pub(crate) fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(to)
        .map_err(|err| format!("Failed to create directory {}: {}", to.display(), err))?;
    let entries = std::fs::read_dir(from)
        .map_err(|err| format!("Failed to read directory {}: {}", from.display(), err))?;
    for entry in entries {
        let entry = entry.map_err(|err| format!("Failed to read directory entry: {}", err))?;
        let source_path = entry.path();
        let target_path = to.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if source_path.is_file() {
            std::fs::copy(&source_path, &target_path).map_err(|err| {
                format!(
                    "Failed to copy {} to {}: {}",
                    source_path.display(),
                    target_path.display(),
                    err
                )
            })?;
        }
    }
    Ok(())
}

/// On Unix: create a symlink `target -> source`.
/// On other platforms: fall back to a full directory copy.
pub(crate) fn link_skill(source: &std::path::Path, target: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, target).map_err(|err| {
            format!(
                "Failed to create symlink {} -> {}: {}",
                target.display(),
                source.display(),
                err
            )
        })
    }
    #[cfg(not(unix))]
    {
        copy_dir_recursive(source, target)
    }
}

/// Remove a skill link (symlink or copied directory) without touching the central store.
fn remove_skill_link(target: &std::path::Path) -> Result<(), String> {
    if target.is_symlink() {
        std::fs::remove_file(target)
            .map_err(|err| format!("Failed to remove symlink {}: {}", target.display(), err))
    } else if target.is_dir() {
        std::fs::remove_dir_all(target)
            .map_err(|err| format!("Failed to remove {}: {}", target.display(), err))
    } else {
        Ok(())
    }
}

pub async fn list_marketplace_skills() -> Result<Vec<MarketplaceSkill>, String> {
    tokio::task::spawn_blocking(scan_marketplace_skills)
        .await
        .map_err(|err| format!("List marketplace skills task failed: {}", err))?
}

pub async fn list_installed_skills(
    selected_agent: String,
    scope: String,
    cwd: Option<String>,
) -> Result<Vec<InstalledSkill>, String> {
    tokio::task::spawn_blocking(move || {
        let install_root = resolve_skills_install_root(&selected_agent, &scope, cwd.as_deref())?;
        scan_installed_skills(&install_root)
    })
    .await
    .map_err(|err| format!("List installed skills task failed: {}", err))?
}

pub async fn install_marketplace_skill(
    skill_md_path: String,
    skill_name: String,
    selected_agent: String,
    scope: String,
    cwd: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let requested_name = skill_name.trim();
        if requested_name.is_empty() {
            return Err("skill_name cannot be empty".to_string());
        }
        if requested_name.contains('/') || requested_name.contains('\\') {
            return Err("skill_name cannot contain path separators".to_string());
        }
        let source_skill_md = PathBuf::from(skill_md_path.trim());
        if !source_skill_md.exists() || !source_skill_md.is_file() {
            return Err(format!(
                "SKILL.md path does not exist: {}",
                source_skill_md.display()
            ));
        }
        let filename_valid = source_skill_md
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.eq_ignore_ascii_case("SKILL.md"))
            .unwrap_or(false);
        if !filename_valid {
            return Err("skill_md_path must point to SKILL.md".to_string());
        }
        let source_dir = source_skill_md.parent().ok_or_else(|| {
            format!(
                "Failed to resolve source directory for {}",
                source_skill_md.display()
            )
        })?;

        // Step 1: install into central store (~/.agents/skills/<name>/)
        let central_dir = central_skills_dir()?;
        std::fs::create_dir_all(&central_dir).map_err(|err| {
            format!(
                "Failed to create central skills directory {}: {}",
                central_dir.display(),
                err
            )
        })?;
        let central_skill_dir = central_dir.join(requested_name);
        if !central_skill_dir.exists() {
            copy_dir_recursive(source_dir, &central_skill_dir)?;
        }

        // Step 2: link central skill into the agent's skills directory
        let install_root = resolve_skills_install_root(&selected_agent, &scope, cwd.as_deref())?;
        std::fs::create_dir_all(&install_root).map_err(|err| {
            format!(
                "Failed to create agent skills directory {}: {}",
                install_root.display(),
                err
            )
        })?;
        let target_dir = install_root.join(requested_name);
        if target_dir.exists() || target_dir.is_symlink() {
            return Ok(target_dir.to_string_lossy().to_string());
        }
        link_skill(&central_skill_dir, &target_dir)?;
        Ok(target_dir.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("Install marketplace skill task failed: {}", err))?
}

pub async fn uninstall_installed_skill(
    skill_name: String,
    selected_agent: String,
    scope: String,
    cwd: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let requested_name = skill_name.trim();
        if requested_name.is_empty() {
            return Err("skill_name cannot be empty".to_string());
        }
        if requested_name.contains('/') || requested_name.contains('\\') {
            return Err("skill_name cannot contain path separators".to_string());
        }

        let install_root = resolve_skills_install_root(&selected_agent, &scope, cwd.as_deref())?;
        let target_dir = install_root.join(requested_name);
        // Remove the agent link only; the central store (~/.agents/skills/) is kept intact
        remove_skill_link(&target_dir)?;
        Ok(target_dir.to_string_lossy().to_string())
    })
    .await
    .map_err(|err| format!("Uninstall installed skill task failed: {}", err))?
}

/// List all skills in the central store with per-agent link status.
pub async fn list_central_skills(
    scope: String,
    cwd: Option<String>,
) -> Result<Vec<CentralSkill>, String> {
    tokio::task::spawn_blocking(move || {
        let central_dir = central_skills_dir()?;
        if !central_dir.exists() {
            return Ok(Vec::new());
        }
        let codex_root = resolve_skills_install_root("codex", &scope, cwd.as_deref())?;
        let cc_root = resolve_skills_install_root("cc", &scope, cwd.as_deref())?;

        let entries = std::fs::read_dir(&central_dir)
            .map_err(|err| format!("Failed to read central skills dir: {}", err))?;

        let mut skills = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|err| format!("Failed to read entry: {}", err))?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if name.is_empty() {
                continue;
            }
            let skill_md = path.join("SKILL.md");
            if !skill_md.is_file() {
                continue;
            }
            let front_matter = parse_skill_front_matter(&skill_md)?;
            let description = front_matter.description.filter(|v| !v.is_empty());
            let codex_link = codex_root.join(&name);
            let cc_link = cc_root.join(&name);
            skills.push(CentralSkill {
                name,
                path: path.to_string_lossy().to_string(),
                description,
                linked_codex: codex_link.exists() || codex_link.is_symlink(),
                linked_cc: cc_link.exists() || cc_link.is_symlink(),
            });
        }
        skills.sort_by_key(|a| a.name.to_lowercase());
        Ok(skills)
    })
    .await
    .map_err(|err| format!("List central skills task failed: {}", err))?
}

/// Create a link from the central store to the given agent's skills directory.
pub async fn link_skill_to_agent(
    skill_name: String,
    agent: String,
    scope: String,
    cwd: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let central_root = central_skills_dir()?;
        let agent_root = resolve_skills_install_root(&agent, &scope, cwd.as_deref())?;
        link_skill_in_roots(&skill_name, &central_root, &agent_root)
    })
    .await
    .map_err(|err| format!("Link skill task failed: {}", err))?
}

pub(crate) fn link_skill_in_roots(
    skill_name: &str,
    central_root: &Path,
    agent_root: &Path,
) -> Result<(), String> {
    let requested_name = validate_skill_name(skill_name)?;
    let central_skill_dir = existing_managed_skill(central_root, requested_name)?;
    let target = managed_skill_path(agent_root, requested_name, true)?;
    if target.is_symlink() {
        if target.canonicalize().ok().as_ref() == Some(&central_skill_dir) {
            return Ok(());
        }
        return Err(format!(
            "Existing skill link has a different target: {}",
            target.display()
        ));
    }
    if target.exists() {
        if target.is_dir() {
            return Ok(());
        }
        return Err(format!(
            "Existing skill target is not a directory: {}",
            target.display()
        ));
    }
    link_skill(&central_skill_dir, &target)
}

/// Remove a skill entirely from the central store and all agent links.
pub async fn delete_central_skill(
    skill_name: String,
    scope: String,
    cwd: Option<String>,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        validate_skill_name(&skill_name)?;
        let agent_roots = ["codex", "cc"]
            .iter()
            .map(|agent| resolve_skills_install_root(agent, &scope, cwd.as_deref()))
            .collect::<Result<Vec<_>, _>>()?;
        delete_skill_in_roots(&skill_name, &central_skills_dir()?, &agent_roots)
    })
    .await
    .map_err(|err| format!("Delete central skill task failed: {}", err))?
}

fn delete_skill_in_roots(
    skill_name: &str,
    central_root: &Path,
    agent_roots: &[PathBuf],
) -> Result<(), String> {
    let requested_name = validate_skill_name(skill_name)?;
    // Validate every root before the first removal. Existing leaf symlinks are
    // unlinked rather than followed, preserving their external destinations.
    let central = managed_skill_path(central_root, requested_name, false)?;
    let links = agent_roots
        .iter()
        .map(|root| managed_skill_path(root, requested_name, false))
        .collect::<Result<Vec<_>, _>>()?;
    for link in links {
        remove_skill_link(&link)?;
    }
    remove_skill_link(&central)?;
    Ok(())
}

// ── Skill Groups ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillGroup {
    pub id: String,
    pub name: String,
    pub skill_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillGroupsConfig {
    pub groups: Vec<SkillGroup>,
}

fn skill_groups_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir()
        .ok_or_else(|| "Failed to resolve home directory".to_string())?;
    Ok(home.join(".agents").join("skill-groups.json"))
}

pub async fn read_skill_groups() -> Result<SkillGroupsConfig, String> {
    tokio::task::spawn_blocking(move || {
        let path = skill_groups_path()?;
        if !path.exists() {
            return Ok(SkillGroupsConfig::default());
        }
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read skill-groups.json: {}", e))?;
        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse skill-groups.json: {}", e))
    })
    .await
    .map_err(|e| format!("read_skill_groups task failed: {}", e))?
}

pub async fn write_skill_groups(config: SkillGroupsConfig) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = skill_groups_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
        let content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize skill groups: {}", e))?;
        std::fs::write(&path, content)
            .map_err(|e| format!("Failed to write skill-groups.json: {}", e))
    })
    .await
    .map_err(|e| format!("write_skill_groups task failed: {}", e))?
}

pub async fn clone_skills_repo(url: String) -> Result<String, String> {
    let clone_url = url.trim().to_string();
    if clone_url.is_empty() {
        return Err("url cannot be empty".to_string());
    }
    let repo_subpath = repo_subpath_from_url(&clone_url)?;
    let plugins_root = plugins_root_dir()?;
    ensure_plugins_root(&plugins_root)?;
    let target = plugins_root.join(&repo_subpath);

    let target_for_clone = target.clone();
    let clone_result = tokio::task::spawn_blocking(move || {
        codexia_git::clone(&clone_url, &target_for_clone)
    })
    .await
    .map_err(|err| format!("Clone task failed: {}", err))?;

    let actual_path = match clone_result {
        Ok(path) => path,
        Err(err) => {
            let message = format!("Failed to clone repository: {}", err);
            eprintln!("[git-command] clone failed: {}", err);
            return Err(message);
        }
    };

    let open_path = actual_path.clone();
    let verify_result = tokio::task::spawn_blocking(move || {
        gix::open(&open_path)
            .map(drop)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| format!("Repository verification task failed: {}", err))?;
    if let Err(err) = verify_result {
        let message = format!(
            "Clone finished but gix could not open repository at {}: {}",
            actual_path.display(),
            err
        );
        eprintln!("[git-command] verify failed: {}", err);
        return Err(message);
    }

    Ok(actual_path.to_string_lossy().to_string())
}

#[cfg(test)]
mod skill_boundary_tests {
    use super::*;

    fn roots() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let fixture = tempfile::tempdir().unwrap();
        let central = fixture.path().join("home/.agents/skills");
        let agent = fixture.path().join("native/skills");
        std::fs::create_dir_all(&central).unwrap();
        std::fs::create_dir_all(&agent).unwrap();
        (fixture, central, agent)
    }

    #[test]
    fn link_rejects_parent_and_absolute_names_without_creating_an_external_link() {
        let (fixture, central, agent) = roots();
        let outside = fixture.path().join("home/escaped");
        std::fs::create_dir(&outside).unwrap();
        assert!(link_skill_in_roots("../../escaped", &central, &agent).is_err());
        assert!(!fixture.path().join("escaped").is_symlink());
        assert!(link_skill_in_roots(outside.to_str().unwrap(), &central, &agent).is_err());
        assert!(link_skill_in_roots(".", &central, &agent).is_err());
        assert!(link_skill_in_roots("..", &central, &agent).is_err());
    }

    #[test]
    fn delete_rejects_parent_and_absolute_names_and_preserves_external_files() {
        let (fixture, central, agent) = roots();
        let outside = fixture.path().join("home/escaped");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("sentinel"), "owned fixture").unwrap();
        assert!(delete_skill_in_roots("../../escaped", &central, std::slice::from_ref(&agent)).is_err());
        assert!(outside.join("sentinel").exists());
        assert!(delete_skill_in_roots(outside.to_str().unwrap(), &central, &[agent]).is_err());
        assert!(outside.join("sentinel").exists());
    }

    #[cfg(unix)]
    #[test]
    fn link_rejects_an_external_central_symlink_and_redirected_agent_root() {
        let (fixture, central, agent) = roots();
        let outside = fixture.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, central.join("external")).unwrap();
        assert!(link_skill_in_roots("external", &central, &agent).is_err());
        std::fs::create_dir(central.join("valid")).unwrap();
        let redirected = fixture.path().join("redirected");
        std::os::unix::fs::symlink(&outside, &redirected).unwrap();
        assert!(link_skill_in_roots("valid", &central, &redirected.join("skills")).is_err());
        assert!(!outside.join("skills/valid").exists());
    }

    #[test]
    fn legitimate_link_is_idempotent_and_delete_only_removes_its_own_skill() {
        let (_fixture, central, agent) = roots();
        std::fs::create_dir(central.join("valid-skill")).unwrap();
        std::fs::write(central.join("valid-skill/SKILL.md"), "fixture").unwrap();
        std::fs::create_dir(central.join("keep")).unwrap();
        link_skill_in_roots("valid-skill", &central, &agent).unwrap();
        link_skill_in_roots("valid-skill", &central, &agent).unwrap();
        assert!(agent.join("valid-skill/SKILL.md").exists());
        delete_skill_in_roots("valid-skill", &central, std::slice::from_ref(&agent)).unwrap();
        assert!(!agent.join("valid-skill").exists());
        assert!(!central.join("valid-skill").exists());
        assert!(central.join("keep").exists());
    }

    #[test]
    fn malformed_names_and_project_scopes_fail_before_filesystem_changes() {
        for name in [
            "",
            ".",
            "..",
            "../escaped",
            "/absolute",
            "x\\y",
            "C:drive",
            "nul\0",
            "line\nbreak",
        ] {
            assert!(validate_skill_name(name).is_err(), "accepted {name:?}");
        }
        for name in ["safe-skill", ".system", "name_with_underscore", "技能"] {
            assert_eq!(validate_skill_name(name).unwrap(), name);
        }
        let (fixture, _central, _agent) = roots();
        assert!(resolve_skills_install_root("other", "project", Some("/tmp")).is_err());
        assert!(resolve_skills_install_root("codex", "other", None).is_err());
        assert!(resolve_skills_install_root("codex", "project", None).is_err());
        assert!(resolve_skills_install_root("codex", "project", Some("relative")).is_err());
        let missing = fixture.path().join("missing");
        assert!(resolve_skills_install_root("codex", "project", missing.to_str()).is_err());
        let file = fixture.path().join("file");
        std::fs::write(&file, "fixture").unwrap();
        assert!(resolve_skills_install_root("codex", "project", file.to_str()).is_err());
        assert_eq!(
            resolve_skills_install_root("codex", "project", fixture.path().to_str()).unwrap(),
            fixture.path().canonicalize().unwrap().join(".codex/skills")
        );
    }

    #[cfg(unix)]
    #[test]
    fn deletion_validates_all_roots_first_and_unlinks_leaf_symlinks_without_following_them() {
        let (fixture, central, agent) = roots();
        std::fs::create_dir(central.join("safe")).unwrap();
        let outside = fixture.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("sentinel"), "fixture").unwrap();
        let redirected = fixture.path().join("redirected");
        std::os::unix::fs::symlink(&outside, &redirected).unwrap();
        assert!(
            delete_skill_in_roots(
                "safe",
                &central,
                &[agent.clone(), redirected.join("skills")]
            )
            .is_err()
        );
        assert!(central.join("safe").exists());
        assert!(outside.join("sentinel").exists());
        std::os::unix::fs::symlink(&outside, central.join("leaf-link")).unwrap();
        std::os::unix::fs::symlink(central.join("leaf-link"), agent.join("leaf-link")).unwrap();
        delete_skill_in_roots("leaf-link", &central, &[agent]).unwrap();
        assert!(!central.join("leaf-link").is_symlink());
        assert!(outside.join("sentinel").exists());
    }
}
