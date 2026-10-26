import type { ApprovalsReviewer, AskForApproval, SandboxMode } from "@session/bindings/v2";
import { postJsonWithOptions } from "./apiAdapt/shared";

export interface NativeGlobalConfigCapabilities {
  config: {
    approvals_reviewer: ApprovalsReviewer | null;
    approval_policy: AskForApproval | null;
    sandbox_mode: SandboxMode | null;
    permissions: string | null;
  };
}

export interface NativeConfigRequirements {
  requirements: {
    allowedApprovalPolicies: AskForApproval[] | null;
    allowedApprovalsReviewers: ApprovalsReviewer[] | null;
    allowedSandboxModes: SandboxMode[] | null;
    allowedPermissionProfiles: Record<string, boolean> | null;
    defaultPermissions: string | null;
    /** Optional only for an older runtime that did not preserve this native field. */
    autoReview?: { requiredOnModels: string[] | null } | null;
  } | null;
  /** This proves a bounded runtime-global projection, never thread or account permission.
   * Missing metadata, an unmatched instance, or unavailable data cannot clear a model requirement.
   */
  projection?: {
    version: 1;
    source: "configRequirements/read";
    scope: "runtime-global";
    runtimeInstance: string | null;
  } & (
    | { status: "known"; autoReviewSource: "native-null" | "auto-review-absent" | "auto-review-null" |
        "required-models-absent" | "required-models-null" | "required-models-list" }
    | { status: "unavailable"; autoReviewSource: "invalid" }
  );
}

/** Global defaults only. This does not authorize or configure a captured thread/project. */
export const readNativeGlobalConfigCapabilities = () =>
  postJsonWithOptions<NativeGlobalConfigCapabilities>("/api/codex/config/read", {}, { suppressToast: true });

/** Null requirements remain unknown; this read cannot enable an approval reviewer. */
export const readNativeConfigRequirements = () =>
  postJsonWithOptions<NativeConfigRequirements>("/api/codex/config/requirements/read", {}, { suppressToast: true });
