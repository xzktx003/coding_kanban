use super::to_error_response;
use super::types::InsightFiltersParams;
use axum::Json;

use codexia_shared::insights::{AgentHeatmaps, FilterOptions, Rankings};
use crate::types::ErrorResponse;

pub(crate) async fn api_get_agent_heatmaps(
    Json(params): Json<InsightFiltersParams>,
) -> Result<Json<AgentHeatmaps>, ErrorResponse> {
    let result = codexia_shared::insights::get_agent_heatmaps(
        params.range, params.cwd, params.session_id, params.agent,
    )
    .await
    .map_err(to_error_response)?;
    Ok(Json(result))
}

pub(crate) async fn api_get_insight_rankings(
    Json(params): Json<InsightFiltersParams>,
) -> Result<Json<Rankings>, ErrorResponse> {
    let result = codexia_shared::insights::get_insight_rankings(
        params.range, params.cwd, params.session_id, params.agent,
    )
    .await
    .map_err(to_error_response)?;
    Ok(Json(result))
}

pub(crate) async fn api_get_insight_filter_options(
) -> Result<Json<FilterOptions>, ErrorResponse> {
    let result = codexia_shared::insights::get_insight_filter_options()
        .await
        .map_err(to_error_response)?;
    Ok(Json(result))
}
