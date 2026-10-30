import { useCCStore } from "../stores/cc";
import { ccResolvePermission } from "./apiAdapt/cc";
import type { PermissionDecision } from "../components/cc/types/permission";
/** Capture the request's own session before awaiting, then patch that exact request. */
export async function resolveClaudePermission(
  requestId: string,
  decision: PermissionDecision,
) {
  const target = Object.entries(useCCStore.getState().sessionMessagesMap).find(
    ([, rows]) =>
      rows.some(
        (m) => m.type === "permission_request" && m.requestId === requestId,
      ),
  );
  const original = target?.[1].find(
    (m) => m.type === "permission_request" && m.requestId === requestId,
  );
  await ccResolvePermission(requestId, decision);
  if (!target || original?.type !== "permission_request") return;
  const current = useCCStore.getState(),
    index = (current.sessionMessagesMap[target[0]] ?? []).findIndex(
      (m) =>
        m.type === "permission_request" &&
        m.requestId === requestId &&
        m.executionId === original.executionId &&
        m.recoveryRuntimeInstance === original.recoveryRuntimeInstance,
    );
  if (index >= 0)
    current.updateSessionMessage(target[0], index, { resolved: decision });
}
