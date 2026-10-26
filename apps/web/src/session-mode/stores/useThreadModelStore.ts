import {
  mergeNativePermissionMetadata,
  type NativePermissionMetadata,
} from "@session/services/nativeThreadPermissionMetadata";
import { create } from "zustand";
import { persist } from "zustand/middleware";
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
  model: "",
  modelProvider: "openai",
  reasoningEffort: null,
  providerModels: {},
  serviceTier: null,
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
type ThreadModelState = { threads: Record<string, ThreadModelEntry> };

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

export const useThreadModelStore = create<ThreadModelState>()(
  persist(() => ({ threads: {} }), {
    name: "kanban.session.codex-thread-models",
    version: 2,
    partialize: (state) => ({
      ...state,
      threads: withoutThreadPermissionMetadata(state.threads),
    }),
    // Same-version persisted data skips migrate, so reads must strip it too.
    merge: (saved, current) => ({
      ...current,
      ...(withoutPersistedPermissionMetadata(saved) as Partial<ThreadModelState>),
    }),
    migrate: (saved) => {
      const state = saved as { threads?: Record<string, ThreadModelEntry> };
      return {
        threads: Object.fromEntries(
          Object.entries(state.threads ?? {}).map(([id, entry]) => [
            id,
            { ...UNKNOWN, ...withoutNativePermissionMetadata(entry) },
          ]),
        ),
      };
    },
  }),
);

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
    } as Required<ThreadModelSettings>;
  return {
    ...UNKNOWN,
    ...withoutNativePermissionMetadata(useConfigStore.getState()),
  } as Required<ThreadModelSettings>;
}

export function changeThreadModel(
  threadId: string,
  patch: Partial<ThreadModelSettings>,
) {
  useThreadModelStore.setState((s) => {
    const old = s.threads[threadId];
    const before = { ...UNKNOWN, ...old };
    const next = { ...before, ...patch };
    const changedModel =
      next.model !== before.model ||
      next.modelProvider !== before.modelProvider;
    const personalityNotice =
      patch.personality && patch.personality !== before.personality
        ? { personality: patch.personality }
        : old?.personalityNotice;
    const changedFields = EDITABLE_FIELDS.filter(
      (key) => JSON.stringify(next[key]) !== JSON.stringify(before[key]),
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
  });
}

/** Native responses/events belong to the specified thread, including background resumes. */
export function hydrateThreadModel(
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
  if (!value.model) return;
  useThreadModelStore.setState((s) => {
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
    const retainPermissionMetadata = (next: ThreadModelState): ThreadModelState => {
      if (nativePermissionMetadata === old?.nativePermissionMetadata) return next;
      const entry = next.threads[threadId];
      return {
        ...next,
        threads: {
          ...next.threads,
          [threadId]: {
            ...entry,
            nativePermissionMetadata,
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
        return retainPermissionMetadata(s);
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
      });
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
        ? retainPermissionMetadata(s)
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
          });
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
  });
}

export function dismissModelNotice(threadId: string, noticeId: number) {
  useThreadModelStore.setState((s) => {
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
  });
}
