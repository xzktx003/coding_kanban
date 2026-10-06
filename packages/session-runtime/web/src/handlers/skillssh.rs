use super::to_error_response;
use super::types::{SkillsshInstallParams, SkillsshLeaderboardParams, SkillsshSearchParams};
use axum::Json;

use codexia_shared::skillssh::{self, MarketSkill};
use crate::types::ErrorResponse;

pub(crate) async fn api_skillssh_leaderboard(
    Json(params): Json<SkillsshLeaderboardParams>,
) -> Result<Json<Vec<MarketSkill>>, ErrorResponse> {
    let skills = skillssh::fetch_leaderboard(&params.board)
        .await
        .map_err(|e| to_error_response(e.to_string()))?;
    Ok(Json(skills))
}

pub(crate) async fn api_skillssh_search(
    Json(params): Json<SkillsshSearchParams>,
) -> Result<Json<Vec<MarketSkill>>, ErrorResponse> {
    let skills = skillssh::search_skills(&params.query, params.limit as usize)
        .await
        .map_err(|e| to_error_response(e.to_string()))?;
    Ok(Json(skills))
}

pub(crate) async fn api_skillssh_install(
    Json(params): Json<SkillsshInstallParams>,
) -> Result<Json<String>, ErrorResponse> {
    let result = tokio::task::spawn_blocking(move || {
        skillssh::install_from_skillssh(&params.source, &params.skill_id, &params.scope, params.cwd.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| to_error_response(format!("Install task failed: {}", e)))?
    .map_err(to_error_response)?;
    Ok(Json(result))
}
