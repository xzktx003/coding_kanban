import { admitProviderTranscriptRows } from "./providerTranscriptBudget";
import { copyTranscriptText } from "./codexTranscriptMemoryBudget";
import {
  providerTranscriptKey,
  trackProviderTranscript,
  isProviderTranscriptDormant,
  updateProviderTranscript,
  useProviderTranscriptStore,
} from "./sessionProviderTranscriptState";
import type { CCMessage } from "../components/cc/types/messages";
import type { AcpEntry } from "../stores/useAcpStore";

export const isPendingClaudePermission = (row: CCMessage) =>
  row.type === "permission_request" && !row.resolved;
/** Task outcome and permission identities survive body reclamation. */
export function claudeTranscriptMetadata(rows: CCMessage[]) {
  const permissions = rows.filter(isPendingClaudePermission);
  let result: CCMessage | undefined;
  for (let index = rows.length - 1; index >= 0; index--)
    if (rows[index].type === "result") {
      result = rows[index];
      break;
    }
  if (result?.type === "result")
    permissions.push({
      type: "result",
      uuid: result.uuid,
      session_id: result.session_id,
      subtype: result.subtype,
      duration_ms: result.duration_ms,
      duration_api_ms: result.duration_api_ms,
      is_error: result.is_error,
      num_turns: result.num_turns,
      ...(result.is_error && result.result
        ? { result: copyTranscriptText(result.result.slice(0, 2048)) }
        : {}),
    });
  return permissions;
}
export function admitClaudeTranscript(
  id: string | null,
  rows: CCMessage[],
  previous: CCMessage[],
) {
  if (!id) return rows;
  const owner = providerTranscriptKey("cc", id);
  trackProviderTranscript(owner, "cc", id);
  if (isProviderTranscriptDormant(owner)) return claudeTranscriptMetadata(rows);
  try {
    const admitted = admitProviderTranscriptRows(rows, {
      pinned: isPendingClaudePermission,
    });
    if (admitted.trimmed) updateProviderTranscript(owner, { truncated: true });
    const entry = useProviderTranscriptStore.getState().entries[owner];
    if (!entry.loading && !entry.revision)
      updateProviderTranscript(owner, { restoreNeeded: false });
    return admitted.rows;
  } catch (error) {
    updateProviderTranscript(owner, {
      error:
        error instanceof Error ? error.message : "消息过大，请重试只读恢复。",
      restoreNeeded: true,
    });
    return previous;
  }
}
export function admitAcpTranscript(
  owner: string | null,
  sessionId: string | null,
  rows: AcpEntry[],
  previous: AcpEntry[],
) {
  if (!owner || !sessionId) return rows;
  trackProviderTranscript(owner, "acp", sessionId);
  if (isProviderTranscriptDormant(owner)) return [];
  try {
    const admitted = admitProviderTranscriptRows(rows);
    if (admitted.trimmed) updateProviderTranscript(owner, { truncated: true });
    const entry = useProviderTranscriptStore.getState().entries[owner];
    if (!entry.loading && !entry.revision)
      updateProviderTranscript(owner, { restoreNeeded: false });
    return admitted.rows;
  } catch (error) {
    updateProviderTranscript(owner, {
      error:
        error instanceof Error ? error.message : "消息过大，请重试只读恢复。",
      restoreNeeded: true,
    });
    return previous;
  }
}
