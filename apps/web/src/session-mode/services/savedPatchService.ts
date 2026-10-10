import type {
  SavedPatchRequest,
  SavedPatchResult,
} from "@agent-orchestrator/shared";
import { getJsonWithOptions, postJsonWithOptions } from "./apiAdapt/shared";
export function savedPatchApply(request: SavedPatchRequest) {
  return postJsonWithOptions<SavedPatchResult>(
    "/saved-patches/apply",
    request,
    { suppressToast: true },
  );
}
export function savedPatchStatus(threadId: string, requestId: string) {
  return getJsonWithOptions<{ result: SavedPatchResult | null }>(
    `/saved-patches/status?threadId=${encodeURIComponent(threadId)}&requestId=${encodeURIComponent(requestId)}`,
    { suppressToast: true },
  );
}
