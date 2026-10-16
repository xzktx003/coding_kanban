import {
  validNativeInputMention,
  type NativeInputMention,
} from "@agent-orchestrator/shared";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import {
  isExplicitRequestRejection,
  SessionApiError,
} from "@session/services/apiAdapt/shared";

export interface GoalDraftSnapshot {
  objective: string;
  images: readonly string[];
  mentions: readonly NativeInputMention[];
  /** Separate, lossless paste contents; omit them from objective composition. */
  pastedTexts?: readonly string[];
}

export interface GoalMaterialization {
  objective: string;
  /** Call only after a confirmed rejection or before attempting GoalSet.
   * A successful or unknown GoalSet may already reference these files.
   * Cleanup errors propagate; an explicit later retry remains possible.
   */
  cleanup?: () => Promise<void>;
}

const OBJECTIVE_PREFIX = "Read the Codex goal objective file at ";
const OBJECTIVE_SUFFIX = " before continuing.";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Network loss, cancellation, 5xx and untyped errors preserve the references. */
export const isGoalSubmissionUncertain = (error: unknown): boolean =>
  !isExplicitRequestRejection(error);

function captureClient() {
  const endpoint = buildUrl("/goal-attachments");
  const headers = { "Content-Type": "application/json", ...authHeaders() };
  return async (
    operation: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const response = await fetch(`${endpoint}/${operation}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const message =
        object(value) && typeof value.error === "string"
          ? value.error
          : `Goal attachment request failed: ${response.status}`;
      const stage =
        object(value) &&
        (value.deliveryStage === "not-admitted" ||
          value.deliveryStage === "outcome-unknown")
          ? value.deliveryStage
          : undefined;
      throw new SessionApiError(message, response.status, undefined, stage);
    }
    return value;
  };
}

export async function materializeGoalDraft(
  snapshot: GoalDraftSnapshot,
): Promise<GoalMaterialization> {
  // Capture before the first await: changing sessions or drafts must not change
  // what was submitted, or route cleanup to another paired host later on.
  const draft = {
    objective: snapshot.objective.trim(),
    images: [...snapshot.images],
    mentions: snapshot.mentions.map((mention) => ({
      name: mention.name,
      path: mention.path,
    })),
    pastedTexts: [...(snapshot.pastedTexts ?? [])],
  };
  if (draft.mentions.some((mention) => !validNativeInputMention(mention)))
    throw new Error("Invalid Goal mention identity");
  if (
    !draft.objective &&
    !draft.images.length &&
    !draft.pastedTexts.length &&
    !draft.mentions.length
  )
    throw new Error("Goal objective must not be empty");
  if (
    !draft.images.length &&
    !draft.mentions.length &&
    !draft.pastedTexts.length &&
    Array.from(draft.objective).length <= 4000
  )
    return { objective: draft.objective };
  const request = captureClient();
  const value = await request("materialize", draft);
  if (
    !object(value) ||
    typeof value.objective !== "string" ||
    !value.objective.trim() ||
    Array.from(value.objective).length > 4000
  )
    throw new Error("Goal materialization receipt is unknown");
  if (value.cleanup === undefined) return { objective: value.objective };
  if (
    !object(value.cleanup) ||
    typeof value.cleanup.id !== "string" ||
    !UUID.test(value.cleanup.id) ||
    typeof value.cleanup.token !== "string" ||
    !TOKEN.test(value.cleanup.token)
  )
    throw new Error("Goal materialization cleanup receipt is unknown");
  const capability = { id: value.cleanup.id, token: value.cleanup.token };
  let cleaned = false;
  let pending: Promise<void> | undefined;
  const cleanup = () => {
    if (cleaned) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      const value = await request("cleanup", capability);
      if (!object(value) || value.ok !== true)
        throw new Error("Goal attachment cleanup receipt is unknown");
      cleaned = true;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
  return { objective: value.objective, cleanup };
}

export async function readGoalObjective(
  objective: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  if (
    !objective.startsWith(OBJECTIVE_PREFIX) ||
    !objective.endsWith(OBJECTIVE_SUFFIX)
  )
    return objective;
  const value = await captureClient()("read", { objective }, signal);
  signal?.throwIfAborted();
  if (!object(value) || typeof value.objective !== "string")
    throw new Error("Goal objective read receipt is unknown");
  return value.objective;
}
