use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::skills::{
    central_skills_dir, copy_dir_recursive, existing_managed_skill, link_skill_in_roots,
    managed_skill_path, parse_skill_front_matter, resolve_skills_install_root, validate_skill_name,
    validate_skill_source_tree,
};

const USER_AGENT: &str = "skills-manager";
const SEARCH_URL: &str = "https://skills.sh/api/search";

// ─── types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketSkill {
    pub id: String,
    /// GitHub "owner/repo"
    pub source: String,
    /// Skill subdirectory name within the repo
    pub skill_id: String,
    pub name: String,
    pub installs: u64,
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .unwrap_or_default()
}

async fn search_raw(client: &reqwest::Client, query: &str, limit: usize) -> Result<Vec<MarketSkill>> {
    let url = format!("{}?q={}&limit={}", SEARCH_URL, percent_encode(query), limit);
    let resp: serde_json::Value = client
        .get(&url)
        .send()
        .await
        .context("Failed to fetch skills.sh")?
        .json()
        .await
        .context("Failed to parse response")?;

    Ok(parse_skills_response(&resp))
}

fn parse_skills_response(resp: &serde_json::Value) -> Vec<MarketSkill> {
    let arr = if let Some(a) = resp.get("skills").and_then(|v| v.as_array()) {
        a
    } else if let Some(a) = resp.as_array() {
        a
    } else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for item in arr {
        let source = item.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let skill_id = item
            .get("skillId")
            .or_else(|| item.get("skill_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if source.is_empty() || skill_id.is_empty() {
            continue;
        }
        let id = format!("{}/{}", source, skill_id);
        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(&skill_id)
            .to_string();
        let installs = item.get("installs").and_then(|v| v.as_u64()).unwrap_or(0);
        out.push(MarketSkill { id, source, skill_id, name, installs });
    }
    out
}

// ─── leaderboard ─────────────────────────────────────────────────────────────

/// skills.sh no longer embeds data in HTML (client-side rendered).
/// Approximate leaderboard by running several broad searches in parallel,
/// merging and sorting by install count.
pub async fn fetch_leaderboard(_board: &str) -> Result<Vec<MarketSkill>> {
    let terms = ["github", "code", "test", "ai", "react", "python", "skill"];
    let client = build_client();

    let mut handles = Vec::new();
    for term in &terms {
        let c = client.clone();
        let t = term.to_string();
        handles.push(tokio::spawn(async move {
            search_raw(&c, &t, 30).await.unwrap_or_default()
        }));
    }

    let mut seen: HashMap<String, MarketSkill> = HashMap::new();
    for handle in handles {
        if let Ok(skills) = handle.await {
            for s in skills {
                seen.entry(s.id.clone())
                    .and_modify(|e| e.installs = e.installs.max(s.installs))
                    .or_insert(s);
            }
        }
    }

    let mut results: Vec<MarketSkill> = seen.into_values().collect();
    results.sort_by_key(|skill| std::cmp::Reverse(skill.installs));
    Ok(results)
}

// ─── search ──────────────────────────────────────────────────────────────────

pub async fn search_skills(query: &str, limit: usize) -> Result<Vec<MarketSkill>> {
    search_raw(&build_client(), query, limit).await
}

// ─── install ─────────────────────────────────────────────────────────────────

/// Clone `https://github.com/{source}`, extract `{skill_id}` subdirectory,
/// install to central store, then link to both codex and cc agents.
pub fn install_from_skillssh(
    source: &str,
    skill_id: &str,
    scope: &str,
    cwd: Option<&str>,
) -> Result<String> {
    validate_skillssh_source(source)?;
    validate_skill_name(skill_id).map_err(anyhow::Error::msg)?;
    let agent_roots = ["codex", "cc"]
        .iter()
        .map(|agent| resolve_skills_install_root(agent, scope, cwd))
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(anyhow::Error::msg)?;
    let central_dir = central_skills_dir().map_err(anyhow::Error::msg)?;
    let temp_dir = tempfile::tempdir().context("Failed to create temp dir")?;
    let clone_path = temp_dir.path().join("repo");
    let repo_url = format!("https://github.com/{}.git", source);

    codexia_git::clone(&repo_url, &clone_path).context("Failed to clone repository")?;

    install_cloned_skill(&clone_path, skill_id, &central_dir, &agent_roots)
}

fn validate_skillssh_source(source: &str) -> Result<()> {
    let parts = source.split('/').collect::<Vec<_>>();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || part.len() > 255
                || *part == "."
                || *part == ".."
                || !part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
    {
        anyhow::bail!("Skill source must be a GitHub owner/repository");
    }
    Ok(())
}

fn install_cloned_skill(
    repo_root: &std::path::Path,
    skill_id: &str,
    central_dir: &std::path::Path,
    agent_roots: &[PathBuf],
) -> Result<String> {
    validate_skill_name(skill_id).map_err(anyhow::Error::msg)?;
    let skill_dir = find_skill_dir(repo_root, skill_id)?;
    validate_skill_source_tree(&skill_dir, repo_root).map_err(anyhow::Error::msg)?;

    let install_name = {
        let md = skill_dir.join("SKILL.md");
        if md.is_file() {
            parse_skill_front_matter(&md)
                .ok()
                .and_then(|fm| fm.name)
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| skill_id.to_string())
        } else {
            skill_id.to_string()
        }
    };
    let install_name = validate_skill_name(&install_name).map_err(anyhow::Error::msg)?;

    // Validate every destination before creating the central copy or links.
    let central_skill_dir =
        managed_skill_path(central_dir, install_name, false).map_err(anyhow::Error::msg)?;
    for root in agent_roots {
        managed_skill_path(root, install_name, false).map_err(anyhow::Error::msg)?;
    }
    managed_skill_path(central_dir, install_name, true).map_err(anyhow::Error::msg)?;
    if central_skill_dir.exists() || central_skill_dir.is_symlink() {
        existing_managed_skill(central_dir, install_name).map_err(anyhow::Error::msg)?;
    } else {
        copy_dir_recursive(&skill_dir, &central_skill_dir)
            .map_err(anyhow::Error::msg)
            .context("Failed to copy skill to central store")?;
    }

    for root in agent_roots {
        link_skill_in_roots(install_name, central_dir, root).map_err(anyhow::Error::msg)?;
    }

    Ok(central_skill_dir.to_string_lossy().to_string())
}

fn find_skill_dir(repo_root: &std::path::Path, skill_id: &str) -> Result<PathBuf> {
    // 1. Direct subdirectory match: repo/{skill_id}
    let direct = repo_root.join(skill_id);
    if direct.is_dir() {
        return Ok(direct);
    }

    // 2. Inside a skills/ container: repo/skills/{skill_id}
    let in_skills = repo_root.join("skills").join(skill_id);
    if in_skills.is_dir() {
        return Ok(in_skills);
    }

    // 3. Recursive search up to depth 6: match by dir name or SKILL.md `name` field
    let mut name_match: Option<PathBuf> = None;
    for entry in walkdir::WalkDir::new(repo_root).max_depth(6).into_iter().flatten() {
        if entry.file_type().is_dir() {
            let entry_name = entry.file_name().to_string_lossy();
            if entry_name == skill_id {
                return Ok(entry.path().to_path_buf());
            }
            if name_match.is_none() {
                let skill_md = entry.path().join("SKILL.md");
                if skill_md.exists()
                    && let Ok(fm) = crate::skills::parse_skill_front_matter(&skill_md)
                    && fm.name.as_deref() == Some(skill_id)
                {
                    name_match = Some(entry.path().to_path_buf());
                }
            }
        }
    }
    if let Some(path) = name_match {
        return Ok(path);
    }

    // 4. Root is a single-skill repo (has SKILL.md or CLAUDE.md)
    if repo_root.join("SKILL.md").exists() || repo_root.join("CLAUDE.md").exists() {
        return Ok(repo_root.to_path_buf());
    }

    // 5. skills/ or skill/ subdirectory without a name match
    let skills_subdir = repo_root.join("skills");
    if skills_subdir.is_dir() {
        return Ok(skills_subdir);
    }
    let skill_subdir = repo_root.join("skill");
    if skill_subdir.is_dir() {
        return Ok(skill_subdir);
    }

    // 6. Fall back to repo root rather than hard-failing
    Ok(repo_root.to_path_buf())
}

fn percent_encode(input: &str) -> String {
    input
        .bytes()
        .flat_map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                vec![b as char]
            } else {
                format!("%{:02X}", b).chars().collect::<Vec<_>>()
            }
        })
        .collect()
}

#[cfg(test)]
mod skillssh_boundary_tests {
    use super::*;

    #[test]
    fn front_matter_name_cannot_write_outside_the_skill_roots() {
        let fixture = tempfile::tempdir().unwrap();
        let repo = fixture.path().join("repo");
        let central = fixture.path().join("home/.agents/skills");
        let agent = fixture.path().join("native/skills");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::write(
            repo.join("SKILL.md"),
            "---\nname: ../../escaped\n---\nfixture\n",
        )
        .unwrap();
        assert!(install_cloned_skill(&repo, "safe-id", &central, &[agent]).is_err());
        assert!(!fixture.path().join("home/escaped/SKILL.md").exists());
        assert!(!fixture.path().join("escaped").exists());
    }

    #[cfg(unix)]
    #[test]
    fn installer_rejects_a_source_symlink_that_leaves_the_clone() {
        let fixture = tempfile::tempdir().unwrap();
        let repo = fixture.path().join("repo");
        let outside = fixture.path().join("outside");
        let central = fixture.path().join("central");
        std::fs::create_dir(&repo).unwrap();
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("sentinel"), "private fixture content").unwrap();
        std::fs::write(repo.join("SKILL.md"), "---\nname: safe\n---\nfixture\n").unwrap();
        std::os::unix::fs::symlink(&outside, repo.join("linked-content")).unwrap();
        assert!(install_cloned_skill(&repo, "safe-id", &central, &[]).is_err());
        assert!(!central.join("safe").exists());
        assert!(outside.join("sentinel").exists());
    }

    #[test]
    fn legitimate_skill_is_copied_and_linked_without_overwriting_existing_contents() {
        let fixture = tempfile::tempdir().unwrap();
        let repo = fixture.path().join("repo");
        let central = fixture.path().join("central");
        let agent = fixture.path().join("agent");
        std::fs::create_dir(&repo).unwrap();
        std::fs::write(
            repo.join("SKILL.md"),
            "---\nname: safe-skill\n---\nfixture\n",
        )
        .unwrap();
        let result = install_cloned_skill(&repo, "safe-id", &central, std::slice::from_ref(&agent)).unwrap();
        assert_eq!(PathBuf::from(result), central.join("safe-skill"));
        assert!(agent.join("safe-skill/SKILL.md").exists());
        std::fs::write(central.join("safe-skill/SKILL.md"), "preserved existing").unwrap();
        install_cloned_skill(&repo, "safe-id", &central, &[agent]).unwrap();
        assert_eq!(
            std::fs::read_to_string(central.join("safe-skill/SKILL.md")).unwrap(),
            "preserved existing"
        );
    }

    #[test]
    fn malformed_repository_skill_id_or_scope_is_rejected_before_git_clone() {
        for source in [
            "",
            "owner",
            "../repo",
            "owner/../repo",
            "owner/repo?query",
            "owner/repo#fragment",
            "https://github.com/owner/repo",
        ] {
            assert!(install_from_skillssh(source, "safe", "user", None).is_err());
        }
        assert!(validate_skillssh_source("openai/skills").is_ok());
        assert!(install_from_skillssh("openai/skills", "../escaped", "user", None).is_err());
        assert!(install_from_skillssh("openai/skills", "safe", "invalid", None).is_err());
        assert!(
            install_from_skillssh("openai/skills", "safe", "project", Some("relative")).is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn in_repository_file_links_are_preserved_but_cycles_and_destination_redirects_are_rejected() {
        let fixture = tempfile::tempdir().unwrap();
        let repo = fixture.path().join("repo");
        let central = fixture.path().join("central");
        std::fs::create_dir(&repo).unwrap();
        std::fs::write(repo.join("SKILL.md"), "---\nname: safe\n---\nfixture\n").unwrap();
        std::fs::write(repo.join("content"), "safe linked content").unwrap();
        std::os::unix::fs::symlink(repo.join("content"), repo.join("content-link")).unwrap();
        install_cloned_skill(&repo, "safe-id", &central, &[]).unwrap();
        assert_eq!(
            std::fs::read_to_string(central.join("safe/content-link")).unwrap(),
            "safe linked content"
        );
        std::os::unix::fs::symlink(&repo, repo.join("cycle")).unwrap();
        assert!(install_cloned_skill(&repo, "safe-id", &central, &[]).is_err());
        std::fs::remove_file(repo.join("cycle")).unwrap();
        let outside = fixture.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        let redirected = fixture.path().join("redirected");
        std::os::unix::fs::symlink(&outside, &redirected).unwrap();
        let untouched = fixture.path().join("untouched-central");
        assert!(
            install_cloned_skill(&repo, "safe-id", &untouched, &[redirected.join("skills")])
                .is_err()
        );
        assert!(!untouched.exists());
        assert!(!outside.join("skills").exists());
    }
}
