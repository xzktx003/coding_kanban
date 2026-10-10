use serde_json::{Value, json};
use std::future::Future;

pub(super) fn cancel_params(params: Value) -> Result<Value, String> {
    let object = params
        .as_object()
        .ok_or("Cancel parameters must be an object")?;
    if object.len() != 1 || !object.contains_key("loginId") {
        return Err("Only loginId is accepted by native cancel".into());
    }
    let login = params["loginId"]
        .as_str()
        .filter(|id| !id.trim().is_empty() && id.len() <= 512 && !id.chars().any(char::is_control))
        .ok_or("Invalid loginId")?;
    Ok(json!({"loginId":login}))
}

pub(super) fn logout_params(params: Value) -> Result<Value, String> {
    match params.as_object() {
        Some(object) if object.is_empty() => Ok(Value::Null),
        _ => Err("Native logout accepts no parameters".into()),
    }
}

pub(super) async fn cancel_login<F, Fut>(params: Value, mut request: F) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let response = request("account/login/cancel", cancel_params(params)?).await?;
    match response["status"].as_str() {
        Some(status @ ("canceled" | "notFound")) => Ok(json!({"status":status})),
        _ => Err(
            "DELIVERY_UNKNOWN: invalid native cancel receipt; do not retry automatically".into(),
        ),
    }
}

pub(super) async fn logout<F, Fut>(params: Value, mut request: F) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let response = request("account/logout", logout_params(params)?).await?;
    if response.as_object().is_some_and(|object| object.is_empty()) {
        Ok(json!({}))
    } else {
        Err("DELIVERY_UNKNOWN: invalid native logout receipt; do not retry automatically".into())
    }
}

pub(super) fn cancel_scope_params(params: &Value) -> Result<(String, Value), String> {
    let object = params.as_object().ok_or("Cancel scope must be an object")?;
    if object.len() != 2
        || !object.contains_key("runtimeInstance")
        || !object.contains_key("loginId")
    {
        return Err("Cancel requires captured runtimeInstance and loginId only".into());
    }
    let instance = scope_instance(&params["runtimeInstance"])?;
    let native = cancel_params(json!({"loginId":params["loginId"]}))?;
    Ok((instance, native))
}

fn scope_instance(value: &Value) -> Result<String, String> {
    value
        .as_str()
        .filter(|instance| {
            !instance.is_empty() && instance.len() <= 512 && !instance.chars().any(char::is_control)
        })
        .map(str::to_owned)
        .ok_or_else(|| "Invalid runtimeInstance".into())
}

pub(super) fn public_account(account: &Value) -> Result<Value, String> {
    match account["type"].as_str() {
        Some("apiKey") => Ok(json!({"type":"apiKey"})),
        Some("chatgpt") => {
            let email = account
                .get("email")
                .filter(|email| {
                    email.is_null()
                        || email.as_str().is_some_and(|email| {
                            email.len() <= 512 && !email.chars().any(char::is_control)
                        })
                })
                .ok_or("Unknown public account email")?;
            let plan = account["planType"]
                .as_str()
                .filter(|plan| {
                    [
                        "free",
                        "go",
                        "plus",
                        "pro",
                        "prolite",
                        "team",
                        "self_serve_business_usage_based",
                        "business",
                        "ent26",
                        "enterprise_cbp_usage_based",
                        "enterprise",
                        "edu",
                        "unknown",
                    ]
                    .contains(plan)
                })
                .ok_or("Unknown public account plan")?;
            Ok(json!({"type":"chatgpt","email":email,"planType":plan}))
        }
        Some("amazonBedrock") => Ok(
            json!({"type":"amazonBedrock","usesCodexManagedCredentials":account["usesCodexManagedCredentials"].as_bool().ok_or("Unknown public credential-management status")?}),
        ),
        _ => Err("Unknown current public account snapshot".into()),
    }
}

pub(super) fn logout_scope_params(params: &Value) -> Result<(String, Value), String> {
    let object = params.as_object().ok_or("Logout scope must be an object")?;
    if object.len() != 2
        || !object.contains_key("runtimeInstance")
        || !object.contains_key("expectedAccount")
    {
        return Err("Logout requires runtimeInstance and expectedAccount only".into());
    }
    let instance = scope_instance(&params["runtimeInstance"])?;
    let account = public_account(&params["expectedAccount"])?;
    if params["expectedAccount"] != account {
        return Err("Expected account must be the exact minimal public snapshot".into());
    }
    Ok((instance, account))
}

fn require_runtime(captured: &str, actual: Option<&str>) -> Result<(), String> {
    if actual == Some(captured) {
        Ok(())
    } else {
        Err("SESSION_AUTH_SCOPE_CHANGED: runtime instance changed or is unknown; account action was not sent".into())
    }
}

pub(super) async fn cancel_scoped<F, Fut>(
    params: Value,
    actual_instance: Option<&str>,
    request: F,
) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let (instance, native) = cancel_scope_params(&params)?;
    require_runtime(&instance, actual_instance)?;
    cancel_login(native, request).await
}

pub(super) async fn logout_scoped<F, Fut>(
    params: Value,
    actual_instance: Option<&str>,
    mut request: F,
) -> Result<Value, String>
where
    F: FnMut(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, String>>,
{
    let (instance, expected) = logout_scope_params(&params)?;
    require_runtime(&instance, actual_instance)?;
    let response = request("account/read", json!({"refreshToken":false})).await?;
    let current = public_account(&response["account"]).map_err(|_| {
        "SESSION_AUTH_SCOPE_CHANGED: current account snapshot is unknown; logout was not sent"
            .to_owned()
    })?;
    if current != expected {
        return Err(
            "SESSION_AUTH_SCOPE_CHANGED: public account snapshot changed; logout was not sent"
                .into(),
        );
    }
    // Public equality is only a stale-state check. Logout is the confirmed global current-account action.
    logout(json!({}), request).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::ready;

    #[tokio::test]
    async fn stale_or_unknown_runtime_never_dispatches_account_mutation() {
        for actual in [Some("new-runtime"), None] {
            let mut calls = 0;
            assert!(
                cancel_scoped(
                    json!({"runtimeInstance":"captured","loginId":"owned"}),
                    actual,
                    |_, _| {
                        calls += 1;
                        ready(Ok(json!({"status":"canceled"})))
                    }
                )
                .await
                .is_err()
            );
            assert_eq!(calls, 0);
            assert!(
                logout_scoped(
                    json!({"runtimeInstance":"captured","expectedAccount":{"type":"apiKey"}}),
                    actual,
                    |_, _| {
                        calls += 1;
                        ready(Ok(json!({})))
                    }
                )
                .await
                .is_err()
            );
            assert_eq!(calls, 0);
        }
    }

    #[tokio::test]
    async fn scoped_cancel_strips_guard_fields_before_exact_login_rpc() {
        let result = cancel_scoped(
            json!({"runtimeInstance":"current","loginId":"owned"}),
            Some("current"),
            |method, params| {
                assert_eq!(method, "account/login/cancel");
                assert_eq!(params, json!({"loginId":"owned"}));
                ready(Ok(json!({"status":"notFound"})))
            },
        )
        .await
        .unwrap();
        assert_eq!(result, json!({"status":"notFound"}));
    }

    #[tokio::test]
    async fn logout_rechecks_minimal_public_snapshot_then_sends_no_native_params() {
        for account in [
            json!({"type":"apiKey"}),
            json!({"type":"chatgpt","email":"owner@example.invalid","planType":"plus"}),
            json!({"type":"amazonBedrock","usesCodexManagedCredentials":true}),
        ] {
            let mut calls = Vec::new();
            let result = logout_scoped(
                json!({"runtimeInstance":"current","expectedAccount":account}),
                Some("current"),
                |method, params| {
                    calls.push((method, params));
                    ready(Ok(if method == "account/read" {
                        json!({"account":account,"requiresOpenaiAuth":false})
                    } else {
                        json!({})
                    }))
                },
            )
            .await
            .unwrap();
            assert_eq!(
                calls,
                vec![
                    ("account/read", json!({"refreshToken":false})),
                    ("account/logout", Value::Null)
                ]
            );
            assert_eq!(result, json!({}));
        }
    }

    #[tokio::test]
    async fn wrong_or_unknown_current_account_stops_after_readonly_recheck() {
        for account in [
            Value::Null,
            json!({"type":"chatgpt","email":"different@example.invalid","planType":"plus"}),
            json!({"type":"unsupported"}),
        ] {
            let mut calls = Vec::new();
            let result=logout_scoped(json!({"runtimeInstance":"current","expectedAccount":{"type":"chatgpt","email":"owner@example.invalid","planType":"plus"}}),Some("current"),|method,params| {calls.push((method,params));ready(Ok(json!({"account":account}))) }).await;
            assert!(
                result
                    .unwrap_err()
                    .starts_with("SESSION_AUTH_SCOPE_CHANGED:")
            );
            assert_eq!(calls, vec![("account/read", json!({"refreshToken":false}))]);
        }
    }

    #[test]
    fn mutation_scope_rejects_private_fields_unknown_snapshot_and_other_actions() {
        for params in [
            json!({"loginId":"x"}),
            json!({"runtimeInstance":"r","loginId":"x","method":"account/logout"}),
            json!({"runtimeInstance":"r","loginId":"x","cwd":"/private"}),
        ] {
            assert!(cancel_scope_params(&params).is_err());
        }
        for params in [
            json!({"runtimeInstance":"r","expectedAccount":null}),
            json!({"runtimeInstance":"r","expectedAccount":{"type":"apiKey","apiKey":"PRIVATE"}}),
            json!({"runtimeInstance":"r","expectedAccount":{"type":"chatgpt","email":"x","planType":"plus","accountId":"invented"}}),
            json!({"runtimeInstance":"r","expectedAccount":{"type":"apiKey"},"method":"account/logout"}),
        ] {
            assert!(logout_scope_params(&params).is_err());
        }
    }

    #[tokio::test]
    async fn cancel_forwards_only_captured_login_identity_and_both_native_outcomes() {
        for status in ["canceled", "notFound"] {
            let mut calls = Vec::new();
            let result = cancel_login(json!({"loginId":"captured-login"}), |method, params| {
                calls.push((method, params));
                ready(Ok(json!({"status":status})))
            })
            .await
            .unwrap();
            assert_eq!(
                calls,
                vec![("account/login/cancel", json!({"loginId":"captured-login"}))]
            );
            assert_eq!(result, json!({"status":status}));
        }
    }

    #[tokio::test]
    async fn logout_sends_no_native_parameters_and_requires_real_empty_response() {
        let mut calls = Vec::new();
        let result = logout(json!({}), |method, params| {
            calls.push((method, params));
            ready(Ok(json!({})))
        })
        .await
        .unwrap();
        assert_eq!(calls, vec![("account/logout", Value::Null)]);
        assert_eq!(result, json!({}));
    }

    #[tokio::test]
    async fn invalid_account_inputs_never_reach_rpc() {
        for params in [
            json!({}),
            json!({"loginId":""}),
            json!({"loginId":"\n"}),
            json!({"loginId":"  "}),
            json!({"loginId":4}),
            json!({"loginId":"x","method":"account/logout"}),
            json!({"loginId":"x","cwd":"/private"}),
            json!({"loginId":"x".repeat(513)}),
            Value::Null,
        ] {
            let mut calls = 0;
            assert!(
                cancel_login(params, |_, _| {
                    calls += 1;
                    ready(Ok(json!({"status":"canceled"})))
                })
                .await
                .is_err()
            );
            assert_eq!(calls, 0);
        }
        for params in [
            json!({"loginId":"x"}),
            json!({"method":"account/logout"}),
            json!({"accountId":"another"}),
            Value::Null,
        ] {
            let mut calls = 0;
            assert!(
                logout(params, |_, _| {
                    calls += 1;
                    ready(Ok(json!({})))
                })
                .await
                .is_err()
            );
            assert_eq!(calls, 0);
        }
    }

    #[tokio::test]
    async fn unknown_receipts_do_not_report_account_action_success_or_retry() {
        for raw in [json!({"status":"success"}), json!({}), Value::Null] {
            let mut calls = 0;
            assert!(
                cancel_login(json!({"loginId":"x"}), |_, _| {
                    calls += 1;
                    ready(Ok(raw.clone()))
                })
                .await
                .is_err()
            );
            assert_eq!(calls, 1);
        }
        for raw in [json!({"status":"success"}), Value::Null] {
            let mut calls = 0;
            assert!(
                logout(json!({}), |_, _| {
                    calls += 1;
                    ready(Ok(raw.clone()))
                })
                .await
                .is_err()
            );
            assert_eq!(calls, 1);
        }
    }

    #[tokio::test]
    async fn native_errors_are_returned_without_second_account_action() {
        let error = "DELIVERY_UNKNOWN: native receipt lost";
        let mut calls = 0;
        assert_eq!(
            cancel_login(json!({"loginId":"x"}), |_, _| {
                calls += 1;
                ready(Err(error.into()))
            })
            .await
            .unwrap_err(),
            error
        );
        assert_eq!(calls, 1);
        calls = 0;
        assert_eq!(
            logout(json!({}), |_, _| {
                calls += 1;
                ready(Err(error.into()))
            })
            .await
            .unwrap_err(),
            error
        );
        assert_eq!(calls, 1);
    }
}
