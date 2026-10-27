import { MutationNotStartedError } from "./MutationNotStartedError";
import type { ThreadModelSettings } from "../stores/useThreadModelStore";
import type { TurnStartParams } from "@session/bindings/v2";

export const PERMISSION_FIELDS = ["approvalPolicy", "approvalsReviewer", "sandbox", "sandboxPolicy", "webSearchRequest"] as const;
export type ThreadPermissionField = (typeof PERMISSION_FIELDS)[number];
/** Setting provenance, never a lease granting input, writer or reviewer rights. */
export type ThreadPermissionSources = Partial<Record<ThreadPermissionField, "local" | "native">>;

/** Upgrade modern rows by their explicit native fields. Opaque legacy defaults
 * and values merely held in observed behind another pending choice prove nothing. */
export function permissionSourcesFor(value: Partial<ThreadModelSettings> & { nativeSettings?: Partial<ThreadModelSettings>; pending?: boolean; pendingFields?: Array<keyof ThreadModelSettings> } | undefined): ThreadPermissionSources {
  if (value?.permissionSources !== undefined) return { ...value.permissionSources };
  const result: ThreadPermissionSources = {};
  for (const key of PERMISSION_FIELDS) {
    if (value?.nativeSettings !== undefined && value.pending && value.pendingFields?.includes(key)) {
      result[key] = "local";
      continue;
    }
    if (value?.nativeSettings && Object.hasOwn(value.nativeSettings, key) &&
        value.nativeSettings[key] !== undefined &&
        JSON.stringify(value[key]) === JSON.stringify(value.nativeSettings[key])) result[key] = "native";
  }
  return result;
}

/** Omitted fields inherit the native thread. Never send UNKNOWN display defaults. */
export function threadPermissionParameters(settings: Readonly<ThreadModelSettings>): Pick<TurnStartParams, "approvalPolicy" | "approvalsReviewer" | "sandboxPolicy"> {
  const sources = permissionSourcesFor(settings);
  const result: Pick<TurnStartParams, "approvalPolicy" | "approvalsReviewer" | "sandboxPolicy"> = {};
  if (sources.approvalPolicy && settings.approvalPolicy !== undefined) result.approvalPolicy = structuredClone(settings.approvalPolicy);
  if (sources.approvalsReviewer && settings.approvalsReviewer !== undefined) result.approvalsReviewer = settings.approvalsReviewer;
  if (sources.sandboxPolicy && settings.sandboxPolicy) result.sandboxPolicy = structuredClone(settings.sandboxPolicy);
  else if (sources.sandbox && settings.sandbox === "danger-full-access") result.sandboxPolicy = { type: "dangerFullAccess" };
  else if (sources.sandbox && (sources.webSearchRequest || sources.sandbox === "local")) {
    // Choosing a mode explicitly accepts its default network setting. Native
    // mode-only metadata does not describe writable roots/network restrictions.
    const networkAccess = sources.webSearchRequest ? (settings.webSearchRequest ?? false) : false;
    if (settings.sandbox === "read-only") result.sandboxPolicy = { type: "readOnly", networkAccess };
    else if (settings.sandbox === "workspace-write" && sources.sandbox === "local") result.sandboxPolicy = { type: "workspaceWrite", writableRoots: [], networkAccess, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
  }
  if (sources.webSearchRequest === "local" && !result.sandboxPolicy)
    throw new MutationNotStartedError("会话沙箱权限尚未确认，请先选择执行权限，再发送已保留的草稿。");
  return result;
}

export function threadPermissionsKnown(settings: Readonly<ThreadModelSettings>): boolean {
  const s = permissionSourcesFor(settings);
  return !!(s.approvalPolicy && s.approvalsReviewer && (s.sandbox || (s.sandboxPolicy && settings.sandboxPolicy)));
}
