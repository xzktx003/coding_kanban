use super::to_error_response;
use super::types::{
    SkillGroupsScopeParams, SkillGroupsWriteParams,
    SkillsCloneRepoParams, SkillsDeleteCentralParams, SkillsInstallParams,
    SkillsLinkToAgentParams, SkillsMarketplaceParams, SkillsUninstallParams,
};
use axum::Json;

use codexia_shared::skills::{self, CentralSkill, InstalledSkill, MarketplaceSkill, SkillGroupsConfig};
use crate::types::ErrorResponse;

pub(crate) async fn api_skills_list_marketplace(
    _: Json<SkillsMarketplaceParams>,
) -> Result<Json<Vec<MarketplaceSkill>>, ErrorResponse> {
    let skills = skills::list_marketplace_skills()
        .await
        .map_err(to_error_response)?;
    Ok(Json(skills))
}

pub(crate) async fn api_skills_list_installed(
    Json(params): Json<SkillsMarketplaceParams>,
) -> Result<Json<Vec<InstalledSkill>>, ErrorResponse> {
    let skills = skills::list_installed_skills(params.selected_agent, params.scope, params.cwd)
        .await
        .map_err(to_error_response)?;
    Ok(Json(skills))
}

pub(crate) async fn api_skills_install_marketplace(
    Json(params): Json<SkillsInstallParams>,
) -> Result<Json<String>, ErrorResponse> {
    let result = skills::install_marketplace_skill(
        params.skill_md_path,
        params.skill_name,
        params.selected_agent,
        params.scope,
        params.cwd,
    )
    .await
    .map_err(to_error_response)?;
    Ok(Json(result))
}

pub(crate) async fn api_skills_uninstall_installed(
    Json(params): Json<SkillsUninstallParams>,
) -> Result<Json<String>, ErrorResponse> {
    let result = skills::uninstall_installed_skill(
        params.skill_name,
        params.selected_agent,
        params.scope,
        params.cwd,
    )
    .await
    .map_err(to_error_response)?;
    Ok(Json(result))
}

pub(crate) async fn api_skills_clone_repo(
    Json(params): Json<SkillsCloneRepoParams>,
) -> Result<Json<String>, ErrorResponse> {
    let result = skills::clone_skills_repo(params.url)
        .await
        .map_err(to_error_response)?;
    Ok(Json(result))
}

pub(crate) async fn api_skill_groups_read() -> Result<Json<SkillGroupsConfig>, ErrorResponse> {
    let config = skills::read_skill_groups()
        .await
        .map_err(to_error_response)?;
    Ok(Json(config))
}

pub(crate) async fn api_skill_groups_write(
    Json(params): Json<SkillGroupsWriteParams>,
) -> Result<Json<()>, ErrorResponse> {
    skills::write_skill_groups(params.config)
        .await
        .map_err(to_error_response)?;
    Ok(Json(()))
}

pub(crate) async fn api_skills_list_central(
    Json(params): Json<SkillGroupsScopeParams>,
) -> Result<Json<Vec<CentralSkill>>, ErrorResponse> {
    let skills = skills::list_central_skills(params.scope, params.cwd)
        .await
        .map_err(to_error_response)?;
    Ok(Json(skills))
}

pub(crate) async fn api_skills_link_to_agent(
    Json(params): Json<SkillsLinkToAgentParams>,
) -> Result<Json<()>, ErrorResponse> {
    skills::link_skill_to_agent(params.skill_name, params.agent, params.scope, params.cwd)
        .await
        .map_err(to_error_response)?;
    Ok(Json(()))
}

pub(crate) async fn api_skills_delete_central(
    Json(params): Json<SkillsDeleteCentralParams>,
) -> Result<Json<()>, ErrorResponse> {
    skills::delete_central_skill(params.skill_name, params.scope, params.cwd)
        .await
        .map_err(to_error_response)?;
    Ok(Json(()))
}
