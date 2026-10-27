import { PERMISSION_FIELDS, permissionSourcesFor, type ThreadPermissionSources } from "../services/threadPermissionProjection";
import {
  mergeNativePermissionMetadata,
  type NativePermissionMetadata,
} from "@session/services/nativeThreadPermissionMetadata";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import {
  createThreadModelPersistence,
  THREAD_MODEL_LEGACY_KEY,
  sameThreadModelValue,
  ThreadModelPersistenceError,
  type ThreadModelReadToken,
  type ThreadModelStorageStatus,
  type SettingsIntent,
} from "./threadModelPersistence";
export type {
  ThreadModelReadToken,
  ThreadModelStorageStatus,
} from "./threadModelPersistence";
import type {
  ReasoningEffort,
  CollaborationMode,
  Personality,
} from "@session/bindings";
import type {
  AskForApproval,
  SandboxMode,
  SandboxPolicy,
  ApprovalsReviewer,
} from "@session/bindings/v2";
import { useConfigStore } from "@session/components/codex/stores/useConfigStore";

export interface ThreadModelSettings {
  /** Durable setting provenance; never grants native operation authority. */
  permissionSources?: ThreadPermissionSources;
  model: string;
  modelProvider: string;
  reasoningEffort: ReasoningEffort | null;
  providerModels: Record<string, string>;
  serviceTier?: string | null;
  sandbox?: SandboxMode;
  sandboxPolicy?: SandboxPolicy | null;
  approvalPolicy?: AskForApproval;
  approvalsReviewer?: ApprovalsReviewer;
  autoReviewCapability?: ApprovalsReviewer | null;
  webSearchRequest?: boolean;
  collaborationMode?: "default" | "plan";
  personality?: Personality | null;
}
export interface ModelChangeNotice {
  id: number;
  identity?: string;
  from: string;
  to: string;
  dismissed: boolean;
}
export interface PersonalityNotice {
  personality: Personality;
}
export interface ThreadModelEntry extends ThreadModelSettings {
  /** Volatile per-field last observations, never a current permission/source lease. */
  readonly nativePermissionMetadata?: NativePermissionMetadata;
  revision: number;
  pending: boolean;
  pendingFields?: Array<keyof ThreadModelSettings>;
  observed?: Omit<ThreadModelSettings, "providerModels">;
  /** Accepted normalized settings accumulated by field, including values held
   * behind a pending choice. Undefined marks legacy entries with unknown provenance.
   * This cache never grants thread input/writer rights or stores response bodies. */
  nativeSettings?: NativeSettings;
  notice?: ModelChangeNotice;
  /** Local transcript line. Not a protocol event and not part of the chat cache. */
  personalityNotice?: PersonalityNotice | null;
}
const UNKNOWN: ThreadModelSettings = {
  permissionSources: {},
  model: "",
  modelProvider: "openai",
  reasoningEffort: null,
  providerModels: {},
  serviceTier: null,
  sandboxPolicy: undefined,
  sandbox: "danger-full-access",
  approvalPolicy: "never",
  approvalsReviewer: "user",
  autoReviewCapability: null,
  webSearchRequest: false,
  collaborationMode: "default",
  personality: null,
};
type NativeSettings = Partial<Omit<ThreadModelSettings, "providerModels">>;
const SANDBOX_FIELDS = [
  "sandbox",
  "sandboxPolicy",
  "webSearchRequest",
] as const;
const REVIEWER_FIELDS = ["approvalsReviewer", "autoReviewCapability"] as const;
const MODEL_FIELDS = ["model", "modelProvider", "reasoningEffort"] as const;
function replaceSettingsGroup(
  target: NativeSettings,
  source: NativeSettings,
  fields: readonly (keyof NativeSettings)[],
) {
  for (const key of fields) delete target[key];
  Object.assign(
    target,
    Object.fromEntries(
      fields
        .filter((key) => Object.hasOwn(source, key))
        .map((key) => [key, source[key]]),
    ),
  );
}
function sameNativeSettings(
  left: NativeSettings | undefined,
  right: NativeSettings | undefined,
) {
  if (left === undefined || right === undefined) return left === right;
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(
      ([key, value]) =>
        Object.hasOwn(right, key) &&
        JSON.stringify(value) ===
          JSON.stringify(right[key as keyof NativeSettings]),
    )
  );
}
function mergeNativeSettings(
  previous: NativeSettings | undefined,
  incoming: NativeSettings,
): NativeSettings {
  const next = { ...previous, ...incoming };
  // Incomplete sandbox metadata must not inherit an older complete policy.
  if (SANDBOX_FIELDS.some((key) => Object.hasOwn(incoming, key)))
    replaceSettingsGroup(next, incoming, SANDBOX_FIELDS);
  return next;
}
const EDITABLE_FIELDS = [
  "model",
  "modelProvider",
  "reasoningEffort",
  "serviceTier",
  "sandbox",
  "sandboxPolicy",
  "approvalPolicy",
  "approvalsReviewer",
  "webSearchRequest",
  "collaborationMode",
  "personality",
] as const;
type ThreadModelState = {
  threads: Record<string, ThreadModelEntry>;
  storage?: Record<string, ThreadModelStorageStatus>;
};

function withoutNativePermissionMetadata<T extends object>(entry: T): T {
  if (
    !entry ||
    typeof entry !== "object" ||
    !Object.hasOwn(entry, "nativePermissionMetadata")
  )
    return entry;
  const clean = { ...entry } as Record<string, unknown>;
  delete clean.nativePermissionMetadata;
  return clean as T;
}

function withoutThreadPermissionMetadata(
  threads: Record<string, ThreadModelEntry>,
): Record<string, ThreadModelEntry> {
  if (!threads || typeof threads !== "object" || Array.isArray(threads))
    return threads;
  let clean: Record<string, ThreadModelEntry> | undefined;
  for (const [id, entry] of Object.entries(threads)) {
    const next = withoutNativePermissionMetadata(entry);
    if (next !== entry) {
      clean ??= { ...threads };
      clean[id] = next;
    }
  }
  return clean ?? threads;
}

function withoutPersistedPermissionMetadata(saved: unknown): unknown {
  if (
    !saved ||
    typeof saved !== "object" ||
    Array.isArray(saved) ||
    !Object.hasOwn(saved, "threads")
  )
    return saved;
  const threads = (saved as { threads?: unknown }).threads;
  if (!threads || typeof threads !== "object" || Array.isArray(threads))
    return saved;
  const clean = withoutThreadPermissionMetadata(
    threads as Record<string, ThreadModelEntry>,
  );
  return clean === threads ? saved : { ...saved, threads: clean };
}

/** Global choices are defaults for a new chat, never overrides for an existing one. */
export function getThreadModelSettings(
  threadId: string | null,
): Required<ThreadModelSettings> {
  if (threadId)
    return {
      ...UNKNOWN,
      ...withoutNativePermissionMetadata(
        useThreadModelStore.getState().threads[threadId],
      ),
      permissionSources: permissionSourcesFor(useThreadModelStore.getState().threads[threadId]),
    } as Required<ThreadModelSettings>;
  return {
    ...UNKNOWN,
    ...withoutNativePermissionMetadata(useConfigStore.getState()),
    permissionSources: Object.fromEntries(PERMISSION_FIELDS.map(key => [key, "local"])),
  } as Required<ThreadModelSettings>;
}

function reduceChangeThreadModel(
  state: ThreadModelState,
  threadId: string,
  patch: Partial<ThreadModelSettings>,
) {
  return ((s: ThreadModelState) => {
    const old = s.threads[threadId];
    const before = { ...UNKNOWN, ...old };
    const sources = permissionSourcesFor(old);
    // Every replay rebases the requested network change on this transaction's
    // actual policy, not the caller's possibly stale copied policy object.
    if (patch.webSearchRequest !== undefined && !Object.hasOwn(patch, "sandboxPolicy") && sources.sandboxPolicy && before.sandboxPolicy && "networkAccess" in before.sandboxPolicy) {
      patch = { ...patch, sandboxPolicy: before.sandboxPolicy.type === "externalSandbox"
        ? { ...before.sandboxPolicy, networkAccess: patch.webSearchRequest ? "enabled" : "restricted" }
        : { ...before.sandboxPolicy, networkAccess: patch.webSearchRequest } };
    }
    const permissionSources = { ...sources };
    for (const key of PERMISSION_FIELDS)
      if (Object.hasOwn(patch, key) && patch[key] !== undefined) permissionSources[key] = "local";
    const next = { ...before, ...patch, permissionSources };
    const changedModel =
      next.model !== before.model ||
      next.modelProvider !== before.modelProvider;
    const personalityNotice =
      patch.personality && patch.personality !== before.personality
        ? { personality: patch.personality }
        : old?.personalityNotice;
    const changedFields = EDITABLE_FIELDS.filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]) ||
        (Object.hasOwn(patch, key) && PERMISSION_FIELDS.includes(key as typeof PERMISSION_FIELDS[number]) &&
          sources[key as typeof PERMISSION_FIELDS[number]] !== "local"),
    );
    if (!changedFields.length) return s;
    const revision = (old?.revision ?? 0) + 1;
    const describe = (v: ThreadModelSettings) =>
      `${v.model || "默认模型"}${v.modelProvider === "openai" ? "" : ` (${v.modelProvider})`}`;
    return {
      threads: {
        ...s.threads,
        [threadId]: {
          ...old,
          ...next,
          nativeSettings: old ? old.nativeSettings : {},
          providerModels: {
            ...before.providerModels,
            ...patch.providerModels,
            [next.modelProvider]: next.model,
          },
          revision,
          pending: true,
          pendingFields: [
            ...new Set([
              ...(old?.pendingFields ??
                (old?.pending
                  ? (["model", "modelProvider", "reasoningEffort"] as const)
                  : [])),
              ...changedFields.filter((key) => key !== "sandboxPolicy"),
            ]),
          ],
          ...(changedModel
            ? {
                notice: {
                  id: revision,
                  from: describe(before),
                  to: describe(next),
                  dismissed: false,
                },
              }
            : {}),
          ...(personalityNotice ? { personalityNotice } : {}),
        },
      },
    };
  })(state);
}

/** Native responses/events belong to the specified thread, including background resumes. */
function reduceHydrateThreadModel(
  state: ThreadModelState,
  threadId: string,
  value: {
    readonly nativePermissionMetadata?: NativePermissionMetadata;
    model?: string;
    modelProvider?: string;
    reasoningEffort?: ReasoningEffort | null;
    serviceTier?: string | null;
    approvalPolicy?: AskForApproval;
    approvalsReviewer?: ApprovalsReviewer;
    sandbox?: SandboxMode | SandboxPolicy;
    sandboxPolicy?: SandboxPolicy;
    webSearchRequest?: boolean;
    collaborationMode?: CollaborationMode | "default" | "plan";
    personality?: Personality | null;
  },
  options: { revision?: number; notify?: boolean; initialOnly?: boolean } = {},
) {
  if (!value.model) return state;
  return ((s: ThreadModelState) => {
    const old = s.threads[threadId];
    // An HTTP history snapshot started before the user's selection cannot undo it.
    if (
      options.revision !== undefined &&
      options.revision !== (old?.revision ?? 0)
    )
      return s;
    const nativePermissionMetadata = mergeNativePermissionMetadata(
      old?.nativePermissionMetadata,
      Object.hasOwn(value, "nativePermissionMetadata")
        ? value.nativePermissionMetadata
        : undefined,
      options.initialOnly,
    );
    // Preserve the original settings branch, including pending/ack decisions.
    // A metadata-only change copies only this entry and advances its existing fence.
    const retainPermissionMetadata = (
      next: ThreadModelState,
      applied: NativeSettings = incoming,
    ): ThreadModelState => {
      // Provenance follows fields actually applied to this settings projection.
      // Pending observations may update nativeSettings without changing any
      // selected permission; a fork seed may apply canonical fields newer than
      // its own incoming payload.
      const entry = next.threads[threadId];
      if (!entry) return next;
      const sources = permissionSourcesFor(old);
      const permissionSources = { ...sources };
      const acceptPermissionObservation = !(options.initialOnly && old && old.nativeSettings === undefined);
      const sandboxPending = old?.pending && SANDBOX_FIELDS.some(key => old.pendingFields?.includes(key));
      if (acceptPermissionObservation && !sandboxPending && !(options.initialOnly && SANDBOX_FIELDS.some(key => sources[key])) && SANDBOX_FIELDS.some(key => Object.hasOwn(applied, key))) {
        for (const key of SANDBOX_FIELDS) delete permissionSources[key];
      }
      for (const key of PERMISSION_FIELDS) {
        if (!acceptPermissionObservation) continue;
        if (!Object.hasOwn(applied, key) || applied[key] === undefined) continue;
        if (options.initialOnly && sources[key]) continue;
        if (JSON.stringify(entry[key]) === JSON.stringify(applied[key]))
          // A confirmed field now comes from this native observation. Do not
          // attach an old local-mode origin to a later different native mode.
          permissionSources[key] = "native";
      }
      if (nativePermissionMetadata === old?.nativePermissionMetadata &&
          sameThreadModelValue(permissionSourcesFor(entry), permissionSources)) return next;
      return {
        ...next,
        threads: {
          ...next.threads,
          [threadId]: {
            ...entry,
            ...(nativePermissionMetadata !== undefined ? { nativePermissionMetadata } : {}),
            permissionSources,
            revision: next === s ? (old?.revision ?? 0) + 1 : entry.revision,
          },
        },
      };
    };
    const nativePolicy =
      value.sandboxPolicy ??
      (typeof value.sandbox === "object" ? value.sandbox : undefined);
    const normalized = {
      ...(value.approvalsReviewer !== undefined
        ? {
            approvalsReviewer: value.approvalsReviewer,
            ...(value.approvalsReviewer !== "user"
              ? { autoReviewCapability: value.approvalsReviewer }
              : {}),
          }
        : {}),
      ...(value.serviceTier !== undefined
        ? { serviceTier: value.serviceTier }
        : {}),
      ...(value.approvalPolicy !== undefined
        ? { approvalPolicy: value.approvalPolicy }
        : {}),
      ...(nativePolicy ? { sandboxPolicy: structuredClone(nativePolicy) } : {}),
      ...(typeof value.sandbox === "string"
        ? { sandbox: value.sandbox }
        : nativePolicy
          ? {
              sandbox:
                nativePolicy.type === "readOnly"
                  ? ("read-only" as const)
                  : nativePolicy.type === "dangerFullAccess"
                    ? ("danger-full-access" as const)
                    : ("workspace-write" as const),
            }
          : {}),
      ...(value.webSearchRequest !== undefined
        ? { webSearchRequest: value.webSearchRequest }
        : nativePolicy && "networkAccess" in nativePolicy
          ? {
              webSearchRequest:
                nativePolicy.networkAccess === true ||
                nativePolicy.networkAccess === "enabled",
            }
          : {}),
      ...(value.collaborationMode !== undefined
        ? {
            collaborationMode:
              typeof value.collaborationMode === "string"
                ? value.collaborationMode
                : value.collaborationMode.mode,
          }
        : {}),
      ...(value.personality !== undefined
        ? { personality: value.personality }
        : {}),
    };
    const observed = {
      model: value.model!,
      modelProvider: value.modelProvider ?? old?.modelProvider ?? "openai",
      reasoningEffort:
        value.reasoningEffort === undefined
          ? (old?.reasoningEffort ?? null)
          : value.reasoningEffort,
      ...normalized,
    };
    // Track explicitly supplied fields, not provider/effort inferred by observed.
    // Legacy entries stay opaque even after a later sparse snapshot.
    const incoming: NativeSettings = {
      model: value.model!,
      ...(value.modelProvider !== undefined
        ? { modelProvider: value.modelProvider }
        : {}),
      ...(value.reasoningEffort !== undefined
        ? { reasoningEffort: value.reasoningEffort }
        : {}),
      ...normalized,
    };
    const nativeSettings =
      old && old.nativeSettings === undefined
        ? undefined
        : mergeNativeSettings(old?.nativeSettings, incoming);
    const sameNative = sameNativeSettings(old?.nativeSettings, nativeSettings);
    if (options.initialOnly && old) {
      if (old.nativeSettings === undefined) return retainPermissionMetadata(s);
      // A fork ACK seeds missing settings; already accepted values are newer.
      const canonical: NativeSettings = { ...incoming, ...old.nativeSettings };
      for (const group of [SANDBOX_FIELDS, REVIEWER_FIELDS])
        if (group.some((key) => Object.hasOwn(old.nativeSettings!, key)))
          replaceSettingsGroup(canonical, old.nativeSettings, group);
      const protectedFields = new Set<keyof ThreadModelSettings>(
        old.pendingFields ?? (old.pending ? MODEL_FIELDS : []),
      );
      for (const group of [MODEL_FIELDS, SANDBOX_FIELDS, REVIEWER_FIELDS])
        if (group.some((key) => protectedFields.has(key)))
          for (const key of group) protectedFields.add(key);
      // policy:null explicitly clears the old policy, even if a later sparse
      // model snapshot has already cleared pending with an empty field list.
      if (
        old.sandboxPolicy === null ||
        (SANDBOX_FIELDS.some((key) =>
          Object.hasOwn(old.nativeSettings!, key),
        ) &&
          !old.nativeSettings.sandboxPolicy)
      )
        for (const key of SANDBOX_FIELDS) protectedFields.add(key);
      const projected = Object.fromEntries(
        Object.entries(canonical).filter(
          ([key]) => !protectedFields.has(key as keyof NativeSettings),
        ),
      ) as NativeSettings;
      const sameProjection = Object.entries(projected).every(
        ([key, v]) =>
          JSON.stringify(old[key as keyof ThreadModelEntry]) ===
          JSON.stringify(v),
      );
      if (sameProjection && sameNativeSettings(old.nativeSettings, canonical))
        return retainPermissionMetadata(s, projected);
      const model = projected.model ?? old.model;
      const provider = projected.modelProvider ?? old.modelProvider;
      return retainPermissionMetadata({
        threads: {
          ...s.threads,
          [threadId]: {
            ...old,
            ...projected,
            nativeSettings: canonical,
            revision: old.revision + 1,
            providerModels:
              projected.model !== undefined ||
              projected.modelProvider !== undefined
                ? { ...old.providerModels, [provider]: model }
                : old.providerModels,
            // The fork receipt must not acknowledge pending choices or alter notices.
          },
        },
      }, projected);
    }
    const matches =
      old?.model === observed.model &&
      old.modelProvider === observed.modelProvider &&
      (old.reasoningEffort === null ||
        old.reasoningEffort === observed.reasoningEffort) &&
      (old.pendingFields ?? []).every(
        (key) =>
          key in observed &&
          JSON.stringify(old[key]) ===
            JSON.stringify(observed[key as keyof typeof observed]),
      );
    const sameObserved =
      old?.observed?.model === observed.model &&
      old.observed.modelProvider === observed.modelProvider &&
      old.observed.reasoningEffort === observed.reasoningEffort &&
      Object.entries(normalized).every(
        ([key, value]) =>
          JSON.stringify(old.observed?.[key as keyof typeof old.observed]) ===
          JSON.stringify(value),
      );
    if (old?.pending && !matches)
      return sameObserved && sameNative
        ? retainPermissionMetadata(s, {})
        : retainPermissionMetadata({
            threads: {
              ...s.threads,
              [threadId]: {
                ...old,
                observed,
                nativeSettings,
                revision: old.revision + 1,
              },
            },
          }, {});
    if (
      old &&
      !old.pending &&
      matches &&
      old.reasoningEffort === observed.reasoningEffort &&
      sameObserved &&
      sameNative
    )
      return retainPermissionMetadata(s);
    const changed =
      old &&
      (old.model !== observed.model ||
        old.modelProvider !== observed.modelProvider);
    const revision = (old?.revision ?? 0) + 1;
    return retainPermissionMetadata({
      threads: {
        ...s.threads,
        [threadId]: {
          ...UNKNOWN,
          ...(!old
            ? {
                sandbox: useConfigStore.getState().sandbox,
                approvalPolicy: useConfigStore.getState().approvalPolicy,
                webSearchRequest: useConfigStore.getState().webSearchRequest,
                collaborationMode: useConfigStore.getState().collaborationMode,
              }
            : {}),
          ...old,
          ...observed,
          observed,
          nativeSettings,
          revision,
          pending: false,
          pendingFields: [],
          providerModels: {
            ...old?.providerModels,
            [observed.modelProvider]: observed.model,
          },
          ...(changed
            ? {
                notice: options.notify
                  ? {
                      id: revision,
                      from: old.model,
                      to: observed.model,
                      dismissed: false,
                    }
                  : undefined,
              }
            : {}),
        },
      },
    });
  })(state);
}

function reduceDismissModelNotice(
  state: ThreadModelState,
  threadId: string,
  noticeId: number,
) {
  return ((s: ThreadModelState) => {
    const old = s.threads[threadId];
    if (!old?.notice || old.notice.id !== noticeId) return s;
    return {
      threads: {
        ...s.threads,
        [threadId]: {
          ...old,
          notice: { ...old.notice, dismissed: true },
        },
      },
    };
  })(state);
}

export type ThreadModelNativeValue = Parameters<
  typeof reduceHydrateThreadModel
>[2];
export type ThreadModelHydrateOptions = {
  revision?: number;
  notify?: boolean;
  initialOnly?: boolean;
  readToken?: ThreadModelReadToken;
};
export type ThreadModelSelectionCapture = {
  threadId: string;
  settings: Readonly<Required<ThreadModelSettings>>;
  token: ThreadModelReadToken;
};
type IntentPayload =
  | { kind: "edit"; patch: Partial<ThreadModelSettings> }
  | {
      kind: "observe" | "ack";
      value: ThreadModelNativeValue;
      options: ThreadModelHydrateOptions;
    }
  | { kind: "dismiss"; noticeId: number; identity?: string };
const groups: Record<string, readonly string[]> = {
  model: MODEL_FIELDS,
  sandbox: SANDBOX_FIELDS,
  reviewer: REVIEWER_FIELDS,
  approval: ["approvalPolicy"],
  speed: ["serviceTier"],
  collaboration: ["collaborationMode"],
  personality: ["personality"],
};
function affectedGroups(patch: object): string[] {
  return Object.entries(groups)
    .filter(([, fields]) => fields.some((key) => Object.hasOwn(patch, key)))
    .map(([key]) => key);
}
function cleanEntry(entry: ThreadModelEntry): ThreadModelEntry {
  if (
    !entry ||
    typeof entry !== "object" ||
    Array.isArray(entry) ||
    (entry.model !== undefined && typeof entry.model !== "string") ||
    (entry.modelProvider !== undefined &&
      typeof entry.modelProvider !== "string")
  )
    throw new ThreadModelPersistenceError(
      "会话设置缓存格式无效，已保留原始备份。",
    );
  if (
    (entry.permissionSources !== undefined && (!entry.permissionSources || typeof entry.permissionSources !== "object" || Array.isArray(entry.permissionSources) ||
      Object.entries(entry.permissionSources).some(([key, source]) => !PERMISSION_FIELDS.includes(key as typeof PERMISSION_FIELDS[number]) || (source !== "local" && source !== "native")))) ||
    (entry.revision !== undefined &&
      (!Number.isSafeInteger(entry.revision) || entry.revision < 0)) ||
    (entry.pending !== undefined && typeof entry.pending !== "boolean") ||
    (entry.pendingFields !== undefined &&
      (!Array.isArray(entry.pendingFields) ||
        entry.pendingFields.some(
          (key) =>
            !EDITABLE_FIELDS.includes(key as (typeof EDITABLE_FIELDS)[number]),
        ))) ||
    (entry.providerModels !== undefined &&
      (!entry.providerModels ||
        typeof entry.providerModels !== "object" ||
        Array.isArray(entry.providerModels) ||
        Object.values(entry.providerModels).some(
          (value) => typeof value !== "string",
        )))
  )
    throw new ThreadModelPersistenceError(
      "会话设置缓存字段损坏，已保留原始内容。",
    );
  return structuredClone(
    withoutNativePermissionMetadata({
      ...UNKNOWN,
      ...entry,
      permissionSources: permissionSourcesFor(entry),
      revision: entry.revision ?? 0,
      pending: entry.pending ?? false,
    }),
  );
}
function legacyEntries(): Record<string, ThreadModelEntry> {
  const raw = localStorage.getItem(THREAD_MODEL_LEGACY_KEY);
  if (!raw) return {};
  let saved: {
    state?: { threads?: Record<string, ThreadModelEntry> };
    version?: number;
  };
  try {
    saved = JSON.parse(raw);
  } catch {
    throw new ThreadModelPersistenceError(
      "旧会话设置备份无法解析，原始内容未修改。",
    );
  }
  const entries = saved.state?.threads;
  if (
    !entries ||
    typeof entries !== "object" ||
    Array.isArray(entries) ||
    (saved.version ?? 0) > 2
  )
    throw new ThreadModelPersistenceError(
      "旧会话设置备份格式不受支持，原始内容未修改。",
    );
  return entries;
}
function reduceIntent(
  entry: ThreadModelEntry | undefined,
  intent: SettingsIntent<IntentPayload>,
): ThreadModelEntry | undefined {
  const state: ThreadModelState = { threads: entry ? { target: entry } : {} };
  const payload = intent.payload;
  let result: ThreadModelState;
  if (payload.kind === "edit")
    result = reduceChangeThreadModel(state, "target", payload.patch);
  else if (payload.kind === "dismiss") {
    if (
      payload.identity !== undefined &&
      entry?.notice?.identity !== payload.identity
    )
      return entry;
    result = reduceDismissModelNotice(
      state,
      "target",
      payload.identity ? entry!.notice!.id : payload.noticeId,
    );
  } else {
    // readToken is checked against the transactional row. Numeric revision is
    // only the legacy local fence and cannot compare revisions across pages.
    result = reduceHydrateThreadModel(state, "target", payload.value, {
      ...payload.options,
      revision: undefined,
    });
  }
  const next = result.threads.target;
  if (next === entry) return entry;
  if (
    next?.notice &&
    next.notice !== entry?.notice &&
    payload.kind !== "dismiss"
  )
    return { ...next, notice: { ...next.notice, identity: intent.id } };
  return next;
}

/** Also used by isolated multi-page contract tests; no environment fallback. */
export function createThreadModelController(
  options: {
    databaseName?: string;
    indexedDB?: IDBFactory;
    legacy?: () => Record<string, ThreadModelEntry>;
    connectEvents?: boolean;
    timeoutMs?: number;
  } = {},
  previous?: {
    store: UseBoundStore<StoreApi<ThreadModelState>>;
    persistence: ReturnType<
      typeof createThreadModelPersistence<ThreadModelEntry, IntentPayload>
    >;
  },
) {
  const store =
    previous?.store ??
    create<ThreadModelState>(() => ({ threads: {}, storage: {} }));
  const persistence = createThreadModelPersistence<
    ThreadModelEntry,
    IntentPayload
  >(
    {
      ...options,
      legacy: options.legacy ?? legacyEntries,
      clean: cleanEntry,
      reduce: reduceIntent,
      get: (id) => store.getState().threads[id],
      apply(id, entry) {
        const old = store.getState().threads[id];
        const next = entry && {
          ...entry,
          ...(entry.nativePermissionMetadata === undefined &&
          old?.nativePermissionMetadata !== undefined
            ? { nativePermissionMetadata: old.nativePermissionMetadata }
            : {}),
        };
        if (sameThreadModelValue(old, next)) return;
        store.setState((s) => ({ threads: { ...s.threads, [id]: next! } }));
      },
      status(id, status) {
        const old = store.getState().storage?.[id];
        if (old?.status === status.status && old?.error === status.error)
          return;
        store.setState((s) => ({ storage: { ...s.storage, [id]: status } }));
      },
    },
    previous?.persistence.handoff,
  );
  const settingsFrom = (value: ThreadModelEntry | undefined) => {
    const entry = { ...UNKNOWN, ...value, permissionSources: permissionSourcesFor(value) };
    return Object.fromEntries(
      Object.keys(UNKNOWN).map((key) => [
        key,
        entry[key as keyof ThreadModelSettings],
      ]),
    ) as Required<ThreadModelSettings>;
  };
  const settings = (id: string) => settingsFrom(store.getState().threads[id]);
  function change(id: string, patch: Partial<ThreadModelSettings>) {
    const before = store.getState();
    const after = reduceChangeThreadModel(before, id, patch);
    if (after === before) return;
    const baseline = { ...UNKNOWN, ...before.threads[id] };
    const changed = Object.fromEntries(
      EDITABLE_FIELDS.filter(
        (key) => Object.hasOwn(patch, key) && (
          JSON.stringify(baseline[key]) !==
          JSON.stringify(after.threads[id][key]) ||
          (PERMISSION_FIELDS.includes(key as typeof PERMISSION_FIELDS[number]) &&
            permissionSourcesFor(before.threads[id])[key as typeof PERMISSION_FIELDS[number]] !== "local")),
      ).map((key) => [key, after.threads[id][key]]),
    ) as Partial<ThreadModelSettings>;
    if (patch.providerModels && affectedGroups(changed).includes("model"))
      changed.providerModels = patch.providerModels;
    persistence.enqueue(id, {
      kind: "edit",
      groups: affectedGroups(changed),
      payload: { kind: "edit", patch: structuredClone(changed) },
    });
  }
  function hydrate(
    id: string,
    value: ThreadModelNativeValue,
    options: ThreadModelHydrateOptions = {},
    kind: "observe" | "ack" = "observe",
  ) {
    if (!value.model) return;
    if (
      options.revision !== undefined &&
      options.revision !== (store.getState().threads[id]?.revision ?? 0)
    )
      return;
    persistence.enqueue(id, {
      kind,
      groups: affectedGroups(value),
      payload: {
        kind,
        value: structuredClone(value),
        options: structuredClone(options),
      },
      readToken: options.readToken,
    });
  }
  function capture(id: string): ThreadModelSelectionCapture {
    const value = structuredClone(settings(id));
    // Values may contain nested sandbox policy/provider maps; freeze recursively.
    const freeze = (v: object) => {
      for (const x of Object.values(v))
        if (x && typeof x === "object") freeze(x);
      Object.freeze(v);
    };
    freeze(value);
    const captured = {
      threadId: id,
      settings: value,
      token: persistence.token(id),
    };
    const receipt = {
      saved: false,
      promise: Promise.resolve(),
      error: undefined as unknown,
    };
    receipt.promise = persistence
      .captureBarrier(id, (entry) =>
        sameThreadModelValue(value, settingsFrom(entry)),
      )
      .then(
        () => {
          receipt.saved = true;
        },
        (error) => {
          receipt.error = error;
          throw error;
        },
      );
    void receipt.promise.catch(() => {});
    persistence.handoff.captures.set(captured, receipt);
    return captured;
  }
  async function flush(id: string, captured?: ThreadModelSelectionCapture) {
    if (!captured) {
      await persistence.flush(id);
      return;
    }
    if (captured.threadId !== id)
      throw new ThreadModelPersistenceError(
        "会话目标已改变，请重新发送。",
        "changed",
      );
    const receipt = persistence.handoff.captures.get(captured);
    if (!receipt)
      throw new ThreadModelPersistenceError(
        "会话设置捕获已失效，请重新发送。",
        "changed",
      );
    await receipt.promise;
    assertCurrent(captured);
  }
  function assertCurrent(captured: ThreadModelSelectionCapture) {
    const current = persistence.token(captured.threadId);
    const receipt = persistence.handoff.captures.get(captured);
    if (
      !receipt?.saved ||
      captured.settings.permissionSources === undefined ||
      receipt.error ||
      captured.token.scope !== current.scope ||
      captured.token.epoch !== current.epoch
    )
      throw new ThreadModelPersistenceError(
        "捕获的会话设置尚未保存或运行实例已改变，请重新发送。",
        "changed",
      );
  }
  const api = {
    store,
    persistence,
    change,
    hydrate,
    capture,
    flush,
    assertCurrent,
    dismiss(id: string, noticeId: number, identity?: string) {
      const old = store.getState().threads[id]?.notice;
      if (
        !old ||
        old.dismissed ||
        // A transaction can renumber this notice after another page changed an
        // independent group. Its UUID still identifies the captured notice.
        (identity !== undefined ? old.identity !== identity : old.id !== noticeId)
      )
        return;
      persistence.enqueue(id, {
        kind: "dismiss",
        groups: [],
        payload: {
          kind: "dismiss",
          noticeId,
          identity: identity ?? old.identity,
        },
      });
    },
    setScope(scope: string | null) {
      persistence.setScope(scope);
      store.setState((s) => {
        const threads = withoutThreadPermissionMetadata(s.threads);
        return threads === s.threads ? s : { threads };
      });
    },
  };
  persistence.handoff.controller = api;
  return api;
}
const previous = import.meta.hot?.data?.threadModelController as
  | ReturnType<typeof createThreadModelController>
  | undefined;
const controller = createThreadModelController({}, previous);
export const useThreadModelStore = Object.assign(controller.store, {
  // Compatibility for explicit cache reload callers. Persistence is now IDB;
  // this never resumes the old full-map localStorage writer.
  persist: {
    rehydrate: async () => {
      const ids = new Set([
        ...Object.keys(controller.store.getState().threads),
        ...controller.persistence.knownIds(),
        ...Object.keys(legacyEntries()),
      ]);
      for (const id of ids) await controller.persistence.ensure(id, true);
    },
  },
});
const currentController = () =>
  (controller.persistence.handoff.controller as
    | ReturnType<typeof createThreadModelController>
    | undefined) ?? controller;
export const ensureThreadModelSettings = (id: string) =>
  currentController().persistence.ensure(id);
export const flushThreadModelSettings = (
  id: string,
  capture?: ThreadModelSelectionCapture,
) => currentController().flush(id, capture);
export const retryThreadModelSettings = (id: string) =>
  currentController().persistence.retry(id);
export const captureThreadModelRead = (id: string) =>
  currentController().persistence.token(id);
export const captureThreadModelSelection = (id: string) =>
  currentController().capture(id);
export const assertThreadModelSelectionCurrent = (
  capture: ThreadModelSelectionCapture,
) => currentController().assertCurrent(capture);
export const setThreadModelRuntimeScope = (scope: string | null) =>
  currentController().setScope(scope);
export const changeThreadModel = (
  id: string,
  patch: Partial<ThreadModelSettings>,
) => currentController().change(id, patch);
export const hydrateThreadModel = (
  id: string,
  value: ThreadModelNativeValue,
  options: ThreadModelHydrateOptions = {},
) => currentController().hydrate(id, value, options);
export const ackThreadModelSettings = (
  id: string,
  value: ThreadModelNativeValue,
  readToken: ThreadModelReadToken,
) => currentController().hydrate(id, value, { readToken }, "ack");
export const dismissModelNotice = (
  id: string,
  noticeId: number,
  identity?: string,
) => currentController().dismiss(id, noticeId, identity);

let persistenceEventClients = 0;
/** Attach cross-tab refresh listeners while the session workbench is mounted. */
export function startThreadModelPersistenceEvents() {
  persistenceEventClients++;
  if (persistenceEventClients === 1)
    currentController().persistence.resume();
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    persistenceEventClients = Math.max(0, persistenceEventClients - 1);
    if (persistenceEventClients === 0)
      currentController().persistence.suspend();
  };
}
/** Tests explicitly reset their own database; production never calls this. */
export async function resetThreadModelPersistenceForTests() {
  await controller.persistence.reset();
  controller.store.setState({ threads: {}, storage: {} });
}
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    controller.persistence.suspend();
    persistenceEventClients = 0;
    data.threadModelController = controller;
  });
