use serde_json::{Value, json};
use std::future::Future;

fn empty_params(params: &Value) -> Result<(), String> {
    match params.as_object() {
        Some(object) if object.is_empty() => Ok(()),
        _ => Err("This readonly endpoint accepts an empty object only".into()),
    }
}

pub(super) fn config_params(params: Value) -> Result<Value, String> {
    empty_params(&params)?;
    Ok(json!({"includeLayers": false}))
}

pub(super) fn requirements_params(params: Value) -> Result<Value, String> {
    empty_params(&params)?;
    Ok(Value::Null)
}

fn bounded_text(value: &Value, max: usize, name: &str) -> Result<String, String> {
    let text = value
        .as_str()
        .filter(|text| !text.is_empty() && text.len() <= max && !text.contains('\0'))
        .ok_or_else(|| format!("Invalid {name}"))?;
    Ok(text.to_owned())
}

pub(super) fn search_params(params: Value) -> Result<Value, String> {
    let object = params
        .as_object()
        .ok_or("Search parameters must be an object")?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "threadId" | "searchTerm" | "cursor" | "limit"))
    {
        return Err("Unknown search parameter".into());
    }
    let thread_id = bounded_text(&params["threadId"], 512, "threadId")?;
    if thread_id.chars().any(char::is_control) {
        return Err("Invalid threadId".into());
    }
    let search_term = bounded_text(&params["searchTerm"], 8192, "searchTerm")?;
    let mut output = json!({"threadId":thread_id,"searchTerm":search_term});
    if let Some(cursor) = object.get("cursor") {
        output["cursor"] = if cursor.is_null() {
            Value::Null
        } else {
            json!(bounded_text(cursor, 65536, "cursor")?)
        };
    }
    if let Some(limit) = object.get("limit") {
        output["limit"] = if limit.is_null() {
            Value::Null
        } else {
            json!(
                limit
                    .as_u64()
                    .filter(|limit| (1..=250).contains(limit))
                    .ok_or("limit must be an integer from 1 to 250")?
            )
        };
    }
    Ok(output)
}

fn enum_value(value: &Value, allowed: &[&str]) -> Value {
    match value.as_str() {
        Some(text) if allowed.contains(&text) => value.clone(),
        _ => Value::Null,
    }
}

fn approval_policy(value: &Value) -> Value {
    if value.is_string() {
        return enum_value(value, &["untrusted", "on-request", "never"]);
    }
    let Some(granular) = value.get("granular").and_then(Value::as_object) else {
        return Value::Null;
    };
    let mut safe = serde_json::Map::new();
    for key in [
        "sandbox_approval",
        "rules",
        "skill_approval",
        "request_permissions",
        "mcp_elicitations",
    ] {
        let Some(boolean) = granular.get(key).and_then(Value::as_bool) else {
            return Value::Null;
        };
        safe.insert(key.into(), json!(boolean));
    }
    json!({"granular":safe})
}

fn permission_name(value: &Value) -> Value {
    match value.as_str() {
        Some(name)
            if !name.is_empty()
                && name.len() <= 160
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-_: .".contains(c)) =>
        {
            json!(name)
        }
        _ => Value::Null,
    }
}

pub(super) async fn read_config<F, Fut>(params: Value, mut request: F) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let response = request("config/read", config_params(params)?).await?;
    let config = response
        .get("config")
        .filter(|config| config.is_object())
        .ok_or("Invalid native config response")?;
    Ok(json!({"config":{
        "approvals_reviewer":enum_value(&config["approvals_reviewer"], &["user", "auto_review", "guardian_subagent"]),
        "approval_policy":approval_policy(&config["approval_policy"]),
        "sandbox_mode":enum_value(&config["sandbox_mode"], &["read-only", "workspace-write", "danger-full-access"]),
        "permissions":permission_name(&config["permissions"]),
    }}))
}

pub(super) async fn read_requirements<F, Fut>(
    params: Value,
    mut request: F,
) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let response = request("configRequirements/read", requirements_params(params)?).await?;
    let requirements = response
        .get("requirements")
        .ok_or("Missing native requirements")?;
    if requirements.is_null() {
        return Ok(json!({"requirements":null}));
    }
    if !requirements.is_object() {
        return Err("Invalid native requirements".into());
    }
    let array = |key: &str, project: fn(&Value) -> Value| -> Value {
        requirements[key]
            .as_array()
            .map(|values| {
                Value::Array(
                    values
                        .iter()
                        .map(project)
                        .filter(|v| !v.is_null())
                        .collect(),
                )
            })
            .unwrap_or(Value::Null)
    };
    let profiles = requirements["allowedPermissionProfiles"]
        .as_object()
        .map(|profiles| {
            profiles
                .iter()
                .filter(|(name, value)| {
                    !permission_name(&json!(name)).is_null() && value.is_boolean()
                })
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect::<serde_json::Map<_, _>>()
        });
    Ok(json!({"requirements":{
        "allowedApprovalPolicies":array("allowedApprovalPolicies",approval_policy),
        "allowedApprovalsReviewers":array("allowedApprovalsReviewers",|v| enum_value(v,&["user","auto_review","guardian_subagent"])),
        "allowedSandboxModes":array("allowedSandboxModes",|v| enum_value(v,&["read-only","workspace-write","danger-full-access"])),
        "allowedPermissionProfiles":profiles,
        "defaultPermissions":permission_name(&requirements["defaultPermissions"]),
    }}))
}

pub(super) async fn search_occurrences<F, Fut>(
    params: Value,
    mut request: F,
) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    request("thread/searchOccurrences", search_params(params)?).await
}

pub(super) fn unsupported(error: &str) -> bool {
    error
        .strip_prefix("Request failed: ")
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .is_some_and(|value| {
            let code = value["code"].as_i64();
            let message = value["message"].as_str().unwrap_or("");
            code == Some(-32601)
                || (code == Some(-32600)
                    && (message.contains("unknown variant") || message.contains("unknown method"))
                    && [
                        "thread/searchOccurrences",
                        "config/read",
                        "configRequirements/read",
                    ]
                    .iter()
                    .any(|method| message.contains(method)))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::ready;

    #[test]
    fn unsupported_requires_native_method_not_found_or_exact_legacy_method_rejection() {
        for error in [
            "Request failed: {\"code\":-32601,\"message\":\"Method not found\"}",
            "Request failed: {\"code\":-32600,\"message\":\"unknown variant `thread/searchOccurrences`\"}",
        ] {
            assert!(unsupported(error));
        }
        for error in [
            "Request failed: {\"code\":-32600,\"message\":\"invalid searchTerm\"}",
            "Request failed: {\"code\":-32000,\"message\":\"thread is busy\"}",
            "Method not found",
        ] {
            assert!(!unsupported(error));
        }
    }

    #[tokio::test]
    async fn config_read_forces_no_layers_and_projects_only_safe_capabilities() {
        let raw = json!({"config":{"approvals_reviewer":"guardian_subagent","approval_policy":{"granular":{"sandbox_approval":true,"rules":false,"skill_approval":true,"request_permissions":false,"mcp_elicitations":true,"credential":"SECRET"}},"sandbox_mode":"workspace-write","permissions":"profile:team","model_providers":{"private":{"api_key":"SECRET"}},"instructions":"PRIVATE"},"origins":{"private":"PRIVATE"},"layers":[{"auth":"SECRET"}]});
        let result = read_config(json!({}), |method, params| {
            assert_eq!(method, "config/read");
            assert_eq!(params, json!({"includeLayers":false}));
            ready(Ok(raw.clone()))
        })
        .await
        .unwrap();
        assert_eq!(
            result,
            json!({"config":{"approvals_reviewer":"guardian_subagent","approval_policy":{"granular":{"sandbox_approval":true,"rules":false,"skill_approval":true,"request_permissions":false,"mcp_elicitations":true}},"sandbox_mode":"workspace-write","permissions":"profile:team"}})
        );
        assert!(!result.to_string().contains("SECRET"));
        assert!(!result.to_string().contains("PRIVATE"));
    }

    #[tokio::test]
    async fn requirements_uses_actual_native_method_and_excludes_private_paths_and_network() {
        let result=read_requirements(json!({}), |method,params| {
            assert_eq!(method,"configRequirements/read");
            assert!(params.is_null());
            ready(Ok(json!({"requirements":{"allowedApprovalPolicies":["never","on-request"],"allowedApprovalsReviewers":["user"],"allowedSandboxModes":["read-only"],"allowedPermissionProfiles":{"team":true},"defaultPermissions":"team","network":{"proxyUrl":"SECRET"},"sqliteHome":"PRIVATE","unknown":"SECRET"}})))
        }).await.unwrap();
        assert_eq!(
            result,
            json!({"requirements":{"allowedApprovalPolicies":["never","on-request"],"allowedApprovalsReviewers":["user"],"allowedSandboxModes":["read-only"],"allowedPermissionProfiles":{"team":true},"defaultPermissions":"team"}})
        );
    }

    #[tokio::test]
    async fn absence_stays_unknown_and_never_becomes_default_permissions() {
        assert_eq!(
            read_config(json!({}), |_, _| ready(Ok(json!({"config":{}}))))
                .await
                .unwrap(),
            json!({"config":{"approvals_reviewer":null,"approval_policy":null,"sandbox_mode":null,"permissions":null}})
        );
        assert_eq!(
            read_requirements(json!({}), |_, _| ready(Ok(json!({"requirements":null}))))
                .await
                .unwrap(),
            json!({"requirements":null})
        );
    }

    #[tokio::test]
    async fn search_retains_literal_unicode_cursor_and_native_utf16_identity_without_resume() {
        let raw = json!({"data":[{"turnId":"turn","itemId":"item","snippet":"a😀 needle","snippetMatchRange":{"start":4,"end":10},"turnCursor":"opaque:turn"}],"nextCursor":"opaque:next"});
        let mut calls = Vec::new();
        let params = json!({"threadId":"thread","searchTerm":"😀 needle","cursor":"opaque:search","limit":250});
        let result = search_occurrences(params.clone(), |method, request_params| {
            calls.push((method, request_params));
            ready(Ok(raw.clone()))
        })
        .await
        .unwrap();
        assert_eq!(calls, vec![("thread/searchOccurrences", params)]);
        assert_eq!(result, raw);
    }

    #[tokio::test]
    async fn invalid_or_extra_search_inputs_never_call_native() {
        for params in [
            json!({}),
            json!({"threadId":"t","searchTerm":""}),
            json!({"threadId":"t","searchTerm":"x","limit":251}),
            json!({"threadId":"t","searchTerm":"x","limit":0}),
            json!({"threadId":"t","searchTerm":"x","limit":1.5}),
            json!({"threadId":"t","searchTerm":"x","cwd":"/private"}),
            json!({"threadId":"t","searchTerm":"x","method":"thread/resume"}),
        ] {
            let mut calls = 0;
            assert!(
                search_occurrences(params, |_, _| {
                    calls += 1;
                    ready(Ok(Value::Null))
                })
                .await
                .is_err()
            );
            assert_eq!(calls, 0);
        }
    }

    #[test]
    fn config_browser_paths_layers_and_arbitrary_methods_are_rejected() {
        for params in [
            json!({"cwd":"/private"}),
            json!({"includeLayers":true}),
            json!({"method":"config/value/write"}),
            Value::Null,
        ] {
            assert!(config_params(params.clone()).is_err());
            assert!(requirements_params(params).is_err());
        }
        assert_eq!(
            config_params(json!({})).unwrap(),
            json!({"includeLayers":false})
        );
        assert!(requirements_params(json!({})).unwrap().is_null());
    }

    #[tokio::test]
    async fn native_search_errors_are_returned_without_fallback_or_retry() {
        let mut calls = 0;
        let error = "Request failed: {\"code\":-32601,\"message\":\"Method not found\"}";
        let result = search_occurrences(json!({"threadId":"t","searchTerm":"x"}), |_, _| {
            calls += 1;
            ready(Err(error.into()))
        })
        .await;
        assert_eq!(result.unwrap_err(), error);
        assert_eq!(calls, 1);
    }
}
