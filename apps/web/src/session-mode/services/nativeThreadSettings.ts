import type { hydrateThreadModel } from "@session/stores/useThreadModelStore";
type Settings = Parameters<typeof hydrateThreadModel>[1];
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Read/resume/start and settings notifications have different native field names. */
export function nativeThreadSettings(value: unknown, fallback?: unknown): Settings {
  const defined = (input: unknown) => Object.fromEntries(Object.entries(record(input)).filter(([, v]) => v !== undefined));
  const native = { ...defined(fallback), ...defined(value) };
  return {
    ...(typeof native.model === "string" && native.model ? { model: native.model } : {}),
    ...(typeof native.modelProvider === "string" && native.modelProvider ? { modelProvider: native.modelProvider } : {}),
    ...("reasoningEffort" in native ? { reasoningEffort: native.reasoningEffort as Settings["reasoningEffort"] } : "effort" in native ? { reasoningEffort: native.effort as Settings["reasoningEffort"] } : {}),
    ...("serviceTier" in native ? { serviceTier: native.serviceTier as Settings["serviceTier"] } : {}),
    ...(native.approvalPolicy != null ? { approvalPolicy: native.approvalPolicy as Settings["approvalPolicy"] } : {}),
    ...(native.approvalsReviewer != null ? { approvalsReviewer: native.approvalsReviewer as Settings["approvalsReviewer"] } : {}),
    ...(native.sandboxPolicy ? { sandboxPolicy: native.sandboxPolicy as Settings["sandboxPolicy"] } : typeof native.sandbox === "object" && native.sandbox ? { sandboxPolicy: native.sandbox as Settings["sandboxPolicy"] } : typeof native.sandbox === "string" ? { sandbox: native.sandbox as Settings["sandbox"] } : {}),
    ...(typeof native.webSearchRequest === "boolean" ? { webSearchRequest: native.webSearchRequest } : {}),
    ...(native.collaborationMode ? { collaborationMode: native.collaborationMode as Settings["collaborationMode"] } : {}),
  };
}
