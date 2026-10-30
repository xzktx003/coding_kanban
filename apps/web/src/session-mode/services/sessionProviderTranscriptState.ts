import { create } from "zustand";

export type TranscriptProvider = "cc" | "acp" | "auxiliary";
export interface ProviderTranscriptState {
  kind: TranscriptProvider;
  id: string;
  consumers: number;
  lastUsed: number;
  dormant: boolean;
  restoreNeeded: boolean;
  generation: number;
  reclaimedAt: number;
  lastBytes: number;
  loading: boolean;
  nextCursor: string | null;
  truncated: boolean;
  error: string | null;
  revision?: string;
  /** Exact persisted source boundary; unrelated to native message acceptance. */
  historySourceId?: number;
  /** A bounded, currently displayed readonly page outside the canonical store. */
  externalBodyBytes?: number;
}

const createState = () =>
  create<{
    entries: Record<string, ProviderTranscriptState>;
    revision: number;
  }>(() => ({
    entries: {},
    revision: 0,
  }));
// Only metadata survives a module replacement. Body references stay exclusively
// in the existing CC/ACP stores and cannot be resurrected by an old module.
export const useProviderTranscriptStore: ReturnType<typeof createState> =
  import.meta.hot?.data?.providerTranscriptStore ?? createState();
if (import.meta.hot?.data)
  import.meta.hot.data.providerTranscriptStore = useProviderTranscriptStore;

export function providerTranscriptKey(
  kind: TranscriptProvider,
  id: string,
  agentId?: string,
  connectionId?: string,
) {
  return kind === "cc"
    ? `cc:${id}`
    : JSON.stringify([kind, agentId ?? null, connectionId ?? null, id]);
}
export function trackProviderTranscript(
  owner: string,
  kind: TranscriptProvider,
  id: string,
) {
  if (useProviderTranscriptStore.getState().entries[owner]) return;
  useProviderTranscriptStore.setState((state) => ({
    revision: state.revision + 1,
    entries: {
      ...state.entries,
      [owner]: {
        kind,
        id,
        consumers: 0,
        lastUsed: Date.now(),
        dormant: false,
        restoreNeeded: true,
        generation: state.revision + 1,
        reclaimedAt: 0,
        lastBytes: 0,
        loading: false,
        nextCursor: null,
        truncated: false,
        error: null,
      },
    },
  }));
}
export function updateProviderTranscript(
  owner: string,
  patch: Partial<ProviderTranscriptState>,
) {
  useProviderTranscriptStore.setState((state) => {
    const before = state.entries[owner];
    if (
      !before ||
      Object.entries(patch).every(
        ([key, value]) =>
          before[key as keyof ProviderTranscriptState] === value,
      )
    )
      return state;
    return { entries: { ...state.entries, [owner]: { ...before, ...patch } } };
  });
}
export function retainProviderTranscript(
  owner: string,
  kind: TranscriptProvider,
  id: string,
) {
  trackProviderTranscript(owner, kind, id);
  const before = useProviderTranscriptStore.getState().entries[owner];
  updateProviderTranscript(owner, {
    consumers: before.consumers + 1,
    dormant: false,
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const entry = useProviderTranscriptStore.getState().entries[owner];
    if (!entry) return;
    updateProviderTranscript(owner, {
      consumers: Math.max(0, entry.consumers - 1),
      ...(entry.consumers === 1 ? { lastUsed: Date.now() } : {}),
    });
  };
}
export function markProviderTranscriptDormant(owner: string, bytes: number) {
  useProviderTranscriptStore.setState((state) => {
    const entry = state.entries[owner];
    if (!entry || entry.consumers || entry.dormant) return state;
    return {
      revision: state.revision + 1,
      entries: {
        ...state.entries,
        [owner]: {
          ...entry,
          dormant: true,
          restoreNeeded: true,
          generation: state.revision + 1,
          reclaimedAt: Date.now(),
          lastBytes: bytes,
          loading: false,
        },
      },
    };
  });
}
export function providerTranscriptGeneration(owner: string) {
  return useProviderTranscriptStore.getState().entries[owner]?.generation ?? 0;
}
export function canPublishProviderTranscript(
  owner: string,
  generation: number,
) {
  const entry = useProviderTranscriptStore.getState().entries[owner];
  return !!entry && !entry.dormant && entry.generation === generation;
}
export function isProviderTranscriptDormant(owner: string) {
  return useProviderTranscriptStore.getState().entries[owner]?.dormant ?? false;
}
export function forgetProviderTranscript(owner: string) {
  useProviderTranscriptStore.setState((state) => {
    if (!state.entries[owner] || state.entries[owner].consumers) return state;
    const entries = { ...state.entries };
    delete entries[owner];
    return { entries };
  });
}

const warmReaders = new Map<
  TranscriptProvider,
  (owner: string, id: string) => void
>();
export function registerProviderWarmReader(
  kind: TranscriptProvider,
  reader: (owner: string, id: string) => void,
) {
  warmReaders.set(kind, reader);
  return () => {
    if (warmReaders.get(kind) === reader) warmReaders.delete(kind);
  };
}
export function hasProviderWarmReader(kind: TranscriptProvider) {
  return warmReaders.has(kind);
}
export function requestProviderWarmRestore(owner: string) {
  const entry = useProviderTranscriptStore.getState().entries[owner];
  const reader = entry && warmReaders.get(entry.kind);
  if (!entry?.dormant || entry.consumers || !reader) return;
  updateProviderTranscript(owner, { dormant: false, lastUsed: Date.now() });
  reader(owner, entry.id);
}
import.meta.hot?.dispose?.(() => warmReaders.clear());

/** An explicit visible detail page shares accounting without a second body cache. */
export function retainExternalTranscriptBody(owner: string, sourceId: string) {
  const identity = `external:${owner}`;
  trackProviderTranscript(identity, "auxiliary", sourceId);
  const release = retainProviderTranscript(identity, "auxiliary", sourceId);
  let disposed = false,
    reportedBytes = 0;
  const report = (bytes: number) => {
    const current = useProviderTranscriptStore.getState().entries[identity];
    if (!current) return;
    updateProviderTranscript(identity, {
      externalBodyBytes: Math.max(
        0,
        (current.externalBodyBytes ?? 0) + bytes - reportedBytes,
      ),
    });
    reportedBytes = bytes;
  };
  return {
    report(bytes: number) {
      if (disposed) return;
      if (!Number.isSafeInteger(bytes) || bytes < 0)
        throw new Error("Invalid external body measurement");
      report(bytes);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      report(0);
      release();
      forgetProviderTranscript(identity);
    },
  };
}
