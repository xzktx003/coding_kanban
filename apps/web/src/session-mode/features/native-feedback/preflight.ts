import { postJsonWithOptions } from "@session/services/apiAdapt/shared";

export type FeedbackPreflightReason =
  | "policy"
  | "configuration"
  | "unavailable";
export interface FeedbackPreflightResponse {
  reason: FeedbackPreflightReason | null;
  runtimeInstance: string;
  provenance: {
    config: "fresh" | "cache" | "default";
    requirements: "fresh" | "cache" | "unavailable";
    account: "native" | "unavailable";
    workspace: "fresh" | "cache" | "not-required" | "unavailable";
  };
}
export interface FeedbackTarget {
  threadId: string | null;
  cwd: string | null;
  draftOwner: string;
}
export const feedbackPreflightPath = "/api/codex/feedback/preflight";

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

/** A missing endpoint or projected/malformed payload is not a policy snapshot. */
export function parseFeedbackPreflight(
  value: unknown,
): FeedbackPreflightResponse {
  if (
    !record(value) ||
    !exactKeys(value, ["reason", "runtimeInstance", "provenance"]) ||
    ![null, "policy", "configuration", "unavailable"].includes(
      value.reason as null,
    ) ||
    typeof value.runtimeInstance !== "string" ||
    !value.runtimeInstance.trim() ||
    new TextEncoder().encode(value.runtimeInstance).byteLength > 256 ||
    /[\u0000-\u001f\u007f]/.test(value.runtimeInstance) ||
    !record(value.provenance) ||
    !exactKeys(value.provenance, [
      "config",
      "requirements",
      "account",
      "workspace",
    ]) ||
    !["fresh", "cache", "default"].includes(
      value.provenance.config as string,
    ) ||
    !["fresh", "cache", "unavailable"].includes(
      value.provenance.requirements as string,
    ) ||
    !["native", "unavailable"].includes(value.provenance.account as string) ||
    !["fresh", "cache", "not-required", "unavailable"].includes(
      value.provenance.workspace as string,
    )
  )
    throw new Error("Feedback permissions are unavailable");
  return value as unknown as FeedbackPreflightResponse;
}

export async function readFeedbackPreflight(
  target: FeedbackTarget,
  signal: AbortSignal,
): Promise<FeedbackPreflightResponse> {
  const body =
    target.threadId === null
      ? { threadId: null, cwd: target.cwd }
      : { threadId: target.threadId };
  return parseFeedbackPreflight(
    await postJsonWithOptions<unknown>(feedbackPreflightPath, body, {
      signal,
      suppressToast: true,
    }),
  );
}
