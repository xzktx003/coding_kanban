import { create } from "zustand";
import type { ReasoningEffort } from "@session/bindings";
import type {
  AskForApproval,
  SandboxMode,
  ApprovalsReviewer,
} from "@session/bindings/v2";
import type { Provider } from "@session/stores/settings";

import type { Personality } from "@session/bindings/Personality";
export type { Personality } from "@session/bindings/Personality";
export type ModeKind = "default" | "plan";
export type ThreadCwdMode = "local" | "worktree";

/** Explicit local model/effort intent; this does not authorize or send a native request. */
export interface ModelSelection {
  model: string;
  reasoningEffort: ReasoningEffort;
  serviceTier?: string | null;
}

/** The persisted new-chat defaults. One `localStorage` key per field. */
export interface ConfigData {
  sandbox: SandboxMode;
  approvalPolicy: AskForApproval;
  approvalsReviewer: ApprovalsReviewer;
  reasoningEffort: ReasoningEffort;
  serviceTier: string | null;
  webSearchRequest: boolean;
  modelProvider: Provider;
  model: string;
  // Last-used model id per provider key (e.g. { openai: 'o3', custom: 'my-model' })
  providerModels: Record<string, string>;
  personality: Personality | null;
  collaborationMode: ModeKind;
  threadCwdMode: ThreadCwdMode;
}

export interface ConfigStore extends ConfigData {
  setModel: (model: string) => void;
  setModelSelection: (selection: ModelSelection) => void;
  setModelProvider: (provider: Provider) => void;
  setAccessMode: (sandbox: SandboxMode) => void;
  setApprovalsReviewer: (reviewer: ApprovalsReviewer) => void;
  setReasoningEffort: (effort: ReasoningEffort) => void;
  setServiceTier: (serviceTier: string | null) => void;
  setWebSearch: (webSearchRequest: boolean) => void;
  setPersonality: (personality: Personality | null) => void;
  setCollaborationMode: (mode: ModeKind) => void;
  setThreadCwdMode: (mode: ThreadCwdMode) => void;
}

export const SANDBOX_APPROVAL_MAP: Record<SandboxMode, AskForApproval> = {
  "read-only": "untrusted",
  "workspace-write": "on-request",
  "danger-full-access": "never",
};

export const SANDBOX_APPROVALS_REVIEWER_MAP: Record<
  SandboxMode,
  ApprovalsReviewer
> = {
  "read-only": "user",
  "workspace-write": "auto_review",
  "danger-full-access": "user",
};

export const approvalsReviewerForSandbox = (
  sandbox: SandboxMode,
): ApprovalsReviewer => SANDBOX_APPROVALS_REVIEWER_MAP[sandbox];

/**
 * These are global, same-device new-chat defaults, and two browser pages on one
 * machine share one `localStorage`. Zustand's `persist` wraps `api.setState` so
 * that *every* setter re-serializes the whole state map under a single key, so a
 * page holding a stale map reverted every field it had not touched — including
 * `sandbox`/`approvalPolicy`, which decide how much disk and network the next
 * chat may reach. Each field therefore owns its own key and only the fields a
 * user actually chose are written, the way `useFollowupSettingsStore` does it.
 *
 * Boundary: this is same-origin `localStorage` per-key write semantics, not
 * cross-device sync and not a compare-and-swap. Two pages writing the *same*
 * field still resolve to the last successful write. Per-thread native settings
 * are a different store with a real transaction (`useThreadModelStore`).
 */
const LEGACY_KEY = "kanban.session.codex-config-storage";
const PREFIX = `${LEGACY_KEY}.v3.`;
const VERSION = 3;

const defaults: ConfigData = {
  webSearchRequest: false,
  sandbox: "danger-full-access",
  approvalPolicy: "never",
  approvalsReviewer: "user",
  reasoningEffort: "medium",
  serviceTier: null,
  modelProvider: "openai",
  model: "",
  providerModels: {},
  personality: "friendly",
  collaborationMode: "default",
  threadCwdMode: "local",
};
type Field = keyof ConfigData;
const fields = Object.keys(defaults) as Field[];

const oneOf =
  (...allowed: string[]) =>
  (value: unknown) =>
    typeof value === "string" && allowed.includes(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A stored field is only adopted when it still matches the shape this build
 * understands; anything else falls back to the default rather than reaching the
 * composer as an unusable value. Predicates are checked, then the value is cast
 * once at the call site — TypeScript cannot express a per-field type guard map.
 */
const validators: Record<Field, (value: unknown) => boolean> = {
  sandbox: oneOf("read-only", "workspace-write", "danger-full-access"),
  approvalPolicy: (value) =>
    oneOf("untrusted", "on-request", "never")(value) ||
    (isRecord(value) && isRecord(value.granular)),
  approvalsReviewer: oneOf("user", "auto_review", "guardian_subagent"),
  // `ReasoningEffort` and `Provider` are open strings in the native bindings.
  reasoningEffort: (value) => typeof value === "string" && value !== "",
  serviceTier: (value) => value === null || typeof value === "string",
  webSearchRequest: (value) => typeof value === "boolean",
  modelProvider: (value) => typeof value === "string" && value !== "",
  model: (value) => typeof value === "string",
  providerModels: (value) =>
    isRecord(value) &&
    Object.values(value).every((model) => typeof model === "string"),
  personality: (value) =>
    value === null || oneOf("none", "friendly", "pragmatic")(value),
  collaborationMode: oneOf("default", "plan"),
  threadCwdMode: oneOf("local", "worktree"),
};

const encode = (value: unknown) => JSON.stringify(value) ?? "null";

/**
 * The pre-v3 whole-state map, read-only and migrated in memory. Initialization
 * must never write this key back: an old page still owns it, and its next write
 * would resurrect stale permissions over a choice already saved here.
 */
function legacyState(): Record<string, unknown> | undefined {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw === null) return undefined;
    const parsed = JSON.parse(raw) as { state?: unknown; version?: unknown };
    const saved = parsed?.state;
    if (!isRecord(saved)) return undefined;
    const version = typeof parsed.version === "number" ? parsed.version : 0;
    // The v2 migration moved the old workspace-write/on-request *default* to
    // full access. Later explicit choices carry their own version and stay.
    if (
      version < 2 &&
      saved.sandbox === "workspace-write" &&
      saved.approvalPolicy === "on-request"
    )
      return {
        ...saved,
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      };
    return saved;
  } catch {
    return undefined;
  }
}

function readField(field: Field, legacy: Record<string, unknown> | undefined) {
  try {
    const encoded = localStorage.getItem(PREFIX + field);
    if (encoded !== null) {
      const value = JSON.parse(encoded) as unknown;
      if (validators[field](value)) return value;
    }
  } catch {
    // An unreadable key is treated as absent, so one corrupt field cannot throw
    // past initialization and leave the whole composer without defaults.
  }
  const fallback = legacy?.[field];
  return validators[field](fallback) ? fallback : undefined;
}

function readAll(): ConfigData {
  const legacy = legacyState();
  const state = { ...defaults };
  for (const field of fields) {
    const value = readField(field, legacy);
    if (value !== undefined) Object.assign(state, { [field]: value });
  }
  return state;
}

/** Fields whose write failed; a cross-page refresh must not drop them. */
const unsaved = new Set<Field>();

function save(patch: Partial<ConfigData>) {
  for (const field of Object.keys(patch) as Field[]) {
    const value = patch[field];
    if (value === undefined) continue;
    try {
      // One atomic key write per explicit user choice. Other fields cannot be
      // lost through a stale page map; same-field conflicts use last write.
      localStorage.setItem(PREFIX + field, encode(value));
      unsaved.delete(field);
    } catch {
      unsaved.add(field);
    }
  }
}

const initial = readAll();

const store = create<ConfigStore>()((set, get) => {
  /** Apply an explicit choice to this page, then persist exactly those fields. */
  const choose = (patch: Partial<ConfigData>) => {
    set(patch as Partial<ConfigStore>);
    save(patch);
  };
  return {
    ...initial,

    setModel: (model: string) => {
      choose({
        model,
        providerModels: {
          ...get().providerModels,
          [get().modelProvider]: model,
        },
      });
    },

    setModelSelection: ({ model, reasoningEffort, serviceTier }) => {
      const state = get();
      if (
        state.model === model &&
        state.reasoningEffort === reasoningEffort &&
        (serviceTier === undefined || state.serviceTier === serviceTier)
      )
        return;
      choose({
        model,
        reasoningEffort,
        ...(serviceTier === undefined ? {} : { serviceTier }),
        providerModels: {
          ...state.providerModels,
          [state.modelProvider]: model,
        },
      });
    },

    setModelProvider: (modelProvider: Provider) => {
      choose({
        modelProvider,
        model: get().providerModels[modelProvider] ?? "",
      });
    },

    // One permission decision: splitting the pair across keys must not let a
    // reload assemble a combination no menu row can produce.
    setAccessMode: (sandbox: SandboxMode) =>
      choose({ sandbox, approvalPolicy: SANDBOX_APPROVAL_MAP[sandbox] }),
    setApprovalsReviewer: (approvalsReviewer) => choose({ approvalsReviewer }),

    setReasoningEffort: (reasoningEffort: ReasoningEffort) =>
      choose({ reasoningEffort }),
    setServiceTier: (serviceTier) => choose({ serviceTier }),

    setWebSearch: (webSearchRequest: boolean) => choose({ webSearchRequest }),

    setPersonality: (personality: Personality | null) =>
      choose({ personality }),

    setCollaborationMode: (collaborationMode: ModeKind) =>
      choose({ collaborationMode }),

    setThreadCwdMode: (threadCwdMode: ThreadCwdMode) =>
      choose({ threadCwdMode }),
  };
});

/** Re-read the current keys. Never applies a delayed event's stale newValue. */
function refresh() {
  const stored = readAll();
  const current = store.getState();
  const patch: Partial<ConfigData> = {};
  for (const field of fields) {
    if (unsaved.has(field)) continue;
    if (encode(stored[field]) === encode(current[field])) continue;
    Object.assign(patch, { [field]: stored[field] });
  }
  if (Object.keys(patch).length) store.setState(patch as Partial<ConfigStore>);
}

export const useConfigStore = Object.assign(store, {
  /**
   * Kept for callers written against Zustand's `persist`. Rehydration is a
   * read of the current per-field keys; it never writes.
   */
  persist: {
    rehydrate: async () => refresh(),
    getOptions: () => ({ name: LEGACY_KEY, version: VERSION }),
    clearStorage: () => {
      for (const field of fields) localStorage.removeItem(PREFIX + field);
    },
  },
});

let syncUsers = 0;

function storageChanged(event: StorageEvent) {
  try {
    if (event.storageArea && event.storageArea !== localStorage) return;
  } catch {
    refresh();
    return;
  }
  if (
    event.key === null ||
    event.key === LEGACY_KEY ||
    fields.some((field) => event.key === PREFIX + field)
  )
    refresh();
}

function detachSync() {
  if (typeof window === "undefined") return;
  syncUsers = 0;
  window.removeEventListener("storage", storageChanged);
  window.removeEventListener("focus", refresh);
}

/** Adopt another page's new-chat defaults as they are saved. */
export function startConfigStoreSync() {
  if (typeof window === "undefined") return () => {};
  if (syncUsers++ === 0) {
    window.addEventListener("storage", storageChanged);
    window.addEventListener("focus", refresh);
  }
  let stopped = false;
  return () => {
    if (stopped || !syncUsers) return;
    stopped = true;
    syncUsers--;
    if (!syncUsers) detachSync();
  };
}

import.meta.hot?.dispose(() => detachSync());
