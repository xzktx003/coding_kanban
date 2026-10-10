import type { ServerNotification } from "@session/bindings";
import type { FileUpdateChange } from "@session/bindings/v2";
import type { ThreadItem } from "@session/bindings/v2";
import type { SavedPatchBatch } from "@agent-orchestrator/shared";
import { isTranscriptMetadataOnly } from "../presentation/transcriptMetadata";
import { getDiffCounts, normalizeUnifiedDiff } from "@session/utils/diff";
import { splitNativePatchFiles as splitUnifiedDiffByFile } from "@session/features/nativePatchPaths";

export type AggregatedFileChange = {
  path: string;
  diff: string;
  kind: FileUpdateChange["kind"];
  addedCount: number;
  removedCount: number;
  transcriptMetadataOnly?: boolean;
};

export type RenderEventContext = {
  renderTermination?: "completed" | "interrupted" | "failed" | "inProgress";
  rollbackTurns?: number;
  events?: ServerNotification[];
  eventIndex?: number;
};

export type DiffViewerInput = {
  original?: string;
  current?: string;
  unifiedDiff?: string;
  displayPath?: string;
};

const defaultUpdateKind: FileUpdateChange["kind"] = {
  type: "update",
  move_path: null,
};

const normalizePathForMatch = (path: string) => path.replace(/\\/g, "/");

const isLikelyUnifiedDiff = (value?: string) => {
  if (!value) return false;
  const text = normalizeUnifiedDiff(value);
  return (
    text.startsWith("diff --git ") ||
    /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(text) ||
    text.includes("\n@@ ") ||
    text.includes("\n--- ") ||
    text.includes("\n+++ ")
  );
};

const normalizeChangeDiff = (_kind: FileUpdateChange["kind"], diff: string) =>
  diff;

const countContentLines = (content?: string) => {
  if (!content) return 0;
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length;
};

const resolveChangeKind = (
  path: string,
  kindEntries: Array<{ path: string; kind: FileUpdateChange["kind"] }>,
): FileUpdateChange["kind"] => {
  const normalizedPath = normalizePathForMatch(path);
  const exact = kindEntries.find(
    (entry) => normalizePathForMatch(entry.path) === normalizedPath,
  );
  if (exact) return exact.kind;

  const suffix = kindEntries.find((entry) =>
    normalizePathForMatch(entry.path).endsWith(`/${normalizedPath}`),
  );
  return suffix?.kind ?? defaultUpdateKind;
};

export const getChangeCounts = (
  kind: FileUpdateChange["kind"],
  diff: string,
) => {
  if (isLikelyUnifiedDiff(diff))
    return getDiffCounts({ unifiedDiff: diff, diffLines: [] });
  if (kind.type === "add") {
    return { addedCount: countContentLines(diff), removedCount: 0 };
  }

  if (kind.type === "delete") {
    return { addedCount: 0, removedCount: countContentLines(diff) };
  }

  return getDiffCounts({
    unifiedDiff: diff,
    diffLines: [],
  });
};

export const getDiffViewerProps = (change: {
  path: string;
  kind: FileUpdateChange["kind"];
  diff: string;
}): DiffViewerInput => {
  if (isLikelyUnifiedDiff(change.diff))
    return { unifiedDiff: change.diff, displayPath: change.path };
  if (change.kind.type === "add") {
    return {
      original: "",
      current: change.diff,
      unifiedDiff: undefined,
      displayPath: change.path,
    };
  }
  if (change.kind.type === "delete") {
    return {
      original: change.diff,
      current: "",
      unifiedDiff: undefined,
      displayPath: change.path,
    };
  }
  return { unifiedDiff: change.diff, displayPath: change.path };
};

export const aggregateFileChanges = (
  changes: FileUpdateChange[],
): AggregatedFileChange[] => {
  const merged = new Map<
    string,
    Omit<AggregatedFileChange, "addedCount" | "removedCount">
  >();

  changes.forEach((change, changeIndex) => {
    const splitDiffs = splitUnifiedDiffByFile(change.diff);
    const entries =
      splitDiffs.length > 0
        ? splitDiffs
        : [{ path: change.path, diff: change.diff ?? "" }];

    entries.forEach((entry, entryIndex) => {
      const fallbackPath = `unknown-${changeIndex + 1}-${entryIndex + 1}`;
      const path = entry.path || change.path || fallbackPath;
      const key = path;
      const existing = merged.get(key);
      const metadataOnly = isTranscriptMetadataOnly(change);
      const normalizedDiff = normalizeChangeDiff(change.kind, entry.diff ?? "");
      const nextDiff = metadataOnly
        ? ""
        : normalizedDiff.trim()
          ? normalizedDiff
          : (existing?.diff ?? "");

      if (existing) {
        existing.kind = change.kind;
        if (nextDiff || metadataOnly) {
          existing.diff = nextDiff;
        }
        if (metadataOnly) existing.transcriptMetadataOnly = true;
        else delete existing.transcriptMetadataOnly;
        return;
      }

      merged.set(key, {
        path,
        diff: nextDiff,
        kind: change.kind,
        ...(metadataOnly ? { transcriptMetadataOnly: true } : {}),
      });
    });
  });

  return Array.from(merged.values()).map((change) => {
    const { addedCount, removedCount } = getChangeCounts(
      change.kind,
      change.diff,
    );
    return {
      ...change,
      addedCount,
      removedCount,
    };
  });
};

export const aggregateTurnChangesFromContext = (
  turnId: string,
  context?: RenderEventContext,
  threadId?: string,
): AggregatedFileChange[] => {
  const events = context?.events;
  const eventIndex = context?.eventIndex ?? -1;

  if (!events || eventIndex < 0) return [];

  const itemChanges: FileUpdateChange[] = [];
  const kindEntries: Array<{ path: string; kind: FileUpdateChange["kind"] }> =
    [];
  let latestTurnDiff = "";

  for (let i = 0; i <= eventIndex; i += 1) {
    const event = events[i];
    if (
      threadId &&
      "threadId" in event.params &&
      event.params.threadId !== threadId
    )
      continue;

    if (
      event.method === "turn/diff/updated" &&
      event.params.turnId === turnId
    ) {
      if (typeof event.params.diff === "string")
        latestTurnDiff = event.params.diff;
      continue;
    }

    if (
      event.method === "item/completed" &&
      event.params.turnId === turnId &&
      event.params.item.type === "fileChange" &&
      event.params.item.status === "completed"
    ) {
      for (const change of event.params.item.changes) {
        itemChanges.push(change);
        kindEntries.push({ path: change.path, kind: change.kind });
      }
    }
  }

  const splitDiffs = splitUnifiedDiffByFile(latestTurnDiff);
  if (splitDiffs.length > 0) {
    return splitDiffs.map((fileDiff, index) => {
      const path = fileDiff.path || `unknown-${index + 1}`;
      const kind = resolveChangeKind(path, kindEntries);
      const normalizedDiff = normalizeChangeDiff(kind, fileDiff.diff);
      const { addedCount, removedCount } = getChangeCounts(
        kind,
        normalizedDiff,
      );
      return {
        path,
        diff: normalizedDiff,
        kind,
        addedCount,
        removedCount,
      };
    });
  }

  return aggregateFileChanges(itemChanges);
};

/** Saved net turn diff is authoritative. Native receipts stay separate for
 * precise Undo/Reapply: the last per-file item is not the complete turn patch. */
export function completedTurnChanges(
  threadId: string,
  turnId: string,
  items: ThreadItem[],
  context?: RenderEventContext,
) {
  const byId = new Map<string, SavedPatchBatch>();
  if (context?.events)
    for (const event of context.events.slice(
      0,
      (context.eventIndex ?? -1) + 1,
    )) {
      if (
        event.method === "item/completed" &&
        event.params.threadId === threadId &&
        event.params.turnId === turnId &&
        event.params.item.type === "fileChange" &&
        event.params.item.status === "completed"
      ) {
        byId.set(event.params.item.id, {
          id: event.params.item.id,
          changes: event.params.item.changes,
        });
      }
    }
  for (const item of items)
    if (
      item.type === "fileChange" &&
      item.status === "completed" &&
      item.changes.length
    )
      byId.set(item.id, { id: item.id, changes: item.changes });
  const batches = [...byId.values()];
  const net = aggregateTurnChangesFromContext(turnId, context, threadId);
  // Legacy history can omit apply status: retain its read-only display, without
  // granting mutation authority to unknown, failed or declined records.
  const visible = items.flatMap((item) =>
    item.type === "fileChange" &&
    (item.status === "completed" || item.status == null)
      ? item.changes
      : [],
  );
  const applied: FileUpdateChange[] = batches
    .flatMap((b) => b.changes)
    .map((c) => ({
      path: c.path,
      diff: c.diff,
      ...(isTranscriptMetadataOnly(c) ? { transcriptMetadataOnly: true } : {}),
      kind:
        c.kind.type === "update"
          ? { type: "update", move_path: c.kind.move_path ?? null }
          : { type: c.kind.type },
    }));
  return {
    changes: net.length
      ? net
      : aggregateFileChanges(visible.length ? visible : applied),
    batches,
  };
}
