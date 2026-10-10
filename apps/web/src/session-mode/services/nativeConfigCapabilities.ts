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
  } | null;
}

/** Global defaults only. This does not authorize or configure a captured thread/project. */
export const readNativeGlobalConfigCapabilities = () =>
  postJsonWithOptions<NativeGlobalConfigCapabilities>("/api/codex/config/read", {}, { suppressToast: true });

/** Null requirements remain unknown; this read cannot enable an approval reviewer. */
export const readNativeConfigRequirements = () =>
  postJsonWithOptions<NativeConfigRequirements>("/api/codex/config/requirements/read", {}, { suppressToast: true });
