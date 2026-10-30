import { useCCStore } from "../stores/cc/ccStore";
import { useAcpStore } from "../stores/useAcpStore";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { estimateTranscriptBytes } from "./codexTranscriptMemoryBudget";
import { claudeTranscriptMetadata } from "./providerTranscriptAdmission";
import { cancelClaudeHistoryRead } from "./followedSessionAuxSync";
import { cancelAcpTranscriptRead } from "./acpTranscriptRead";
import { openedSessions } from "./openedSessions";
import {
  providerTranscriptKey,
  trackProviderTranscript,
  markProviderTranscriptDormant,
  useProviderTranscriptStore,
  hasProviderWarmReader,
  requestProviderWarmRestore,
} from "./sessionProviderTranscriptState";
import type { WarmTranscriptCandidate } from "./sessionWarmRetention";
const prefix = "provider:";
const ownerFromId = (id: string) =>
  id.startsWith(prefix) ? id.slice(prefix.length) : id;

/** Canonical CC/ACP stores are the only body owners. This module holds no copy. */
export function releaseProviderTranscript(id: string) {
  const owner = ownerFromId(id),
    entry = useProviderTranscriptStore.getState().entries[owner];
  if (!entry || entry.consumers || entry.loading || entry.dormant) return;
  if (entry.kind === "cc") {
    const current = useCCStore.getState(),
      rows = current.sessionMessagesMap[entry.id] ?? [];
    markProviderTranscriptDormant(owner, estimateTranscriptBytes(rows));
    cancelClaudeHistoryRead(entry.id);
    const metadata = claudeTranscriptMetadata(rows);
    useCCStore.setState((s) => ({
      sessionMessagesMap: { ...s.sessionMessagesMap, [entry.id]: metadata },
      ...(s.activeSessionId === entry.id ? { messages: metadata } : {}),
    }));
  } else {
    const current = useAcpStore.getState();
    const currentOwner =
      current.sessionId && current.connectionId
        ? providerTranscriptKey(
            "acp",
            current.sessionId,
            current.agentId,
            current.connectionId,
          )
        : null;
    if (currentOwner !== owner) {
      markProviderTranscriptDormant(owner, 0);
      return;
    }
    if (
      current.entries.some(
        (row) =>
          row.role === "user" && row.clientMessageId && !row.historySourceId,
      )
    )
      return;
    markProviderTranscriptDormant(
      owner,
      estimateTranscriptBytes(current.entries),
    );
    cancelAcpTranscriptRead(owner);
    useAcpStore.setState({ entries: [], chunkSealed: false });
  }
}
export function collectProviderTranscriptCandidates(): WarmTranscriptCandidate[] {
  const cc = useCCStore.getState(),
    acp = useAcpStore.getState();
  for (const id of Object.keys(cc.sessionMessagesMap))
    trackProviderTranscript(providerTranscriptKey("cc", id), "cc", id);
  const acpOwner =
    acp.sessionId && acp.connectionId
      ? providerTranscriptKey(
          "acp",
          acp.sessionId,
          acp.agentId,
          acp.connectionId,
        )
      : null;
  if (acpOwner) trackProviderTranscript(acpOwner, "acp", acp.sessionId!);
  const followed = new Set(
    openedSessions()
      .filter((row) => row.kind === "cc")
      .map((row) => row.id),
  );
  const ready = useAgentCenterStore.getState().sharedTabsInitialized;
  for (const [owner, entry] of Object.entries(
    useProviderTranscriptStore.getState().entries,
  )) {
    if (
      entry.kind === "cc" &&
      ready &&
      !followed.has(entry.id) &&
      !entry.consumers &&
      !entry.loading
    )
      releaseProviderTranscript(owner);
  }
  const now = Date.now();
  return Object.entries(useProviderTranscriptStore.getState().entries).map(
    ([owner, entry]) => {
      const rows =
        entry.kind === "cc"
          ? (useCCStore.getState().sessionMessagesMap[entry.id] ?? [])
          : owner === acpOwner
            ? useAcpStore.getState().entries
            : [];
      return {
        id: prefix + owner,
        bytes: estimateTranscriptBytes(rows) + (entry.externalBodyBytes ?? 0),
        lastUsed: entry.lastUsed,
        visible: entry.consumers > 0,
        expired: !entry.consumers && now - entry.lastUsed >= 60_000,
        blocked:
          entry.loading ||
          (entry.kind === "acp" &&
            owner === acpOwner &&
            acp.entries.some(
              (row) =>
                row.role === "user" &&
                row.clientMessageId &&
                !row.historySourceId,
            )) ||
          (entry.dormant &&
            (!hasProviderWarmReader(entry.kind) ||
              (entry.kind === "cc" && !followed.has(entry.id)) ||
              (entry.kind === "acp" && owner !== acpOwner))),
        dormant: entry.dormant,
        reclaimedAt: entry.reclaimedAt,
        lastBytes: entry.lastBytes,
      };
    },
  );
}
export function warmProviderTranscript(id: string) {
  requestProviderWarmRestore(ownerFromId(id));
}
export const isProviderTranscriptCandidate = (id: string) =>
  id.startsWith(prefix);
