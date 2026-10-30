import { createHash } from "node:crypto";
import { historySessionIdentity } from "../core/recent-history.js";

/** A local transcript source. Never send this value to an ACP agent as sessionId. */
export function acpHistorySessionId(
  runtimeInstance: string,
  connectionId: string,
  agentId: string,
  nativeSessionId: string,
): string {
  for (const value of [runtimeInstance, connectionId, agentId, nativeSessionId])
    historySessionIdentity(value);
  return (
    "acph_" +
    createHash("sha256")
      .update(
        JSON.stringify([
          runtimeInstance,
          connectionId,
          agentId,
          nativeSessionId,
        ]),
      )
      .digest("hex")
  );
}
