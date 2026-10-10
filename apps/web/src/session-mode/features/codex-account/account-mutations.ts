import type { Account } from "@session/bindings/v2";
import { buildUrl } from "@session/hooks/runtime";
import {
  getJsonWithOptions,
  postJsonWithOptions,
} from "@session/services/apiAdapt/shared";
export interface AccountRuntime {
  instance: string;
  source: string;
  supportsMutations: boolean;
}
export async function accountRuntime(): Promise<AccountRuntime> {
  const source = buildUrl("/health");
  const health = await getJsonWithOptions<{
    instance?: unknown;
    capabilities?: { codexAccountMutationsV1?: unknown };
  }>("/health", { suppressToast: true });
  if (
    source !== buildUrl("/health") ||
    typeof health.instance !== "string" ||
    !health.instance.trim()
  )
    throw new Error("无法确认当前运行实例，请恢复连接后重试。");
  return {
    source,
    instance: health.instance,
    supportsMutations: health.capabilities?.codexAccountMutationsV1 === true,
  };
}
export function publicAccount(account: Account): Account {
  switch (account.type) {
    case "apiKey":
      return { type: account.type };
    case "chatgpt":
      return {
        type: account.type,
        email: account.email,
        planType: account.planType,
      };
    case "amazonBedrock":
      return {
        type: account.type,
        usesCodexManagedCredentials: account.usesCodexManagedCredentials,
      };
  }
}
export const samePublicAccount = (
  left: Account | null,
  right: Account | null,
) =>
  left === null || right === null
    ? left === right
    : JSON.stringify(publicAccount(left)) ===
      JSON.stringify(publicAccount(right));
export type AccountMutationRequest = {
  owner: AccountRuntime;
  isCurrent: () => boolean;
} & (
  | { operation: "cancel"; loginId: string }
  | { operation: "logout"; expectedAccount: Account }
);
export interface AccountMutationResult {
  status: "complete" | "rejected" | "unavailable" | "uncertain";
  error?: string;
  cancelStatus?: "canceled" | "notFound";
}
const journalKey = "codex-account-mutations-v1";
const journal = new Map<string, "sending" | "complete" | "uncertain">();
// This digest is only a conservative duplicate-send key, never authorization.
// Persist no display email, API key, device code, browser URL or auth token.
function fingerprint(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}
function key(request: AccountMutationRequest) {
  return `${request.operation}:${fingerprint(JSON.stringify([request.owner.source, request.owner.instance, request.operation === "cancel" ? request.loginId : publicAccount(request.expectedAccount)]))}`;
}
function hydrate() {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(journalKey) ?? "[]");
    if (!Array.isArray(rows)) return;
    for (const row of rows.slice(0, 100)) {
      if (
        Array.isArray(row) &&
        typeof row[0] === "string" &&
        /^(cancel|logout):[a-f0-9]+$/.test(row[0]) &&
        ["sending", "complete", "uncertain"].includes(row[1]) &&
        !journal.has(row[0])
      )
        journal.set(row[0], row[1] === "complete" ? "complete" : "uncertain");
    }
  } catch {
    /* Missing storage cannot be used as mutation authority. */
  }
}
function persist() {
  try {
    localStorage.setItem(journalKey, JSON.stringify([...journal]));
    return true;
  } catch {
    return false;
  }
}
export function clearAccountMutationJournalForTests() {
  journal.clear();
  localStorage.removeItem(journalKey);
}
/** A confirmed own login starts a new account era; ambiguous receipts stay locked. */
export function beginConfirmedAccountEra() {
  hydrate();
  for (const [key, status] of journal)
    if (key.startsWith("logout:") && status === "complete") journal.delete(key);
  persist();
}
async function current(request: AccountMutationRequest) {
  if (!request.owner.supportsMutations) return "unavailable" as const;
  if (!request.isCurrent() || request.owner.source !== buildUrl("/health"))
    return "rejected" as const;
  const live = await accountRuntime();
  if (
    !request.isCurrent() ||
    live.source !== request.owner.source ||
    live.instance !== request.owner.instance
  )
    return "rejected" as const;
  return live.supportsMutations ? null : ("unavailable" as const);
}
export async function mutateAccount(
  request: AccountMutationRequest,
): Promise<AccountMutationResult> {
  hydrate();
  const receiptKey = key(request),
    existing = journal.get(receiptKey);
  // Local receipts only suppress sends. They cannot stand in for a current
  // native acknowledgement or settle a different owner after a reload.
  if (existing) return { status: "uncertain" };
  try {
    const stale = await current(request);
    if (stale)
      return {
        status: stale,
        error: "当前运行实例或账户状态已改变，请重新检查。",
      };
  } catch {
    return {
      status: "unavailable",
      error: "无法确认当前运行实例，请恢复连接后重试。",
    };
  }
  // Recheck after the async preflight: simultaneous callers share one receipt.
  if (journal.has(receiptKey)) return { status: "uncertain" };
  // Confirmed terminal receipts may age out. Keep every ambiguous/sending
  // marker so routine successful actions never consume the uncertainty budget.
  if (journal.size >= 100) {
    for (const [savedKey, status] of journal)
      if (status === "complete") journal.delete(savedKey);
  }
  if (journal.size >= 100)
    return { status: "unavailable", error: "请先确认此前操作的状态。" };
  journal.set(receiptKey, "sending");
  if (!persist()) {
    journal.delete(receiptKey);
    return {
      status: "unavailable",
      error: "无法保存操作状态，本次操作未发送。",
    };
  }
  try {
    const response = await postJsonWithOptions<unknown>(
      request.operation === "cancel"
        ? "/api/codex/account/login/cancel"
        : "/api/codex/account/logout",
      request.operation === "cancel"
        ? { loginId: request.loginId, runtimeInstance: request.owner.instance }
        : {
            runtimeInstance: request.owner.instance,
            expectedAccount: publicAccount(request.expectedAccount),
          },
      { suppressToast: true },
    );
    const valid =
      response !== null &&
      typeof response === "object" &&
      !Array.isArray(response) &&
      (request.operation === "logout"
        ? Object.keys(response).length === 0
        : Object.keys(response).length === 1 &&
          "status" in response &&
          ["canceled", "notFound"].includes(String(response.status)));
    if (
      !valid ||
      !request.isCurrent() ||
      request.owner.source !== buildUrl("/health")
    )
      throw new Error("无法确认操作结果，请检查当前状态；不会重复发送。");
    journal.set(receiptKey, "complete");
    persist();
    if (
      request.operation === "cancel" &&
      "status" in response &&
      (response.status === "canceled" || response.status === "notFound")
    )
      return { status: "complete", cancelStatus: response.status };
    return { status: "complete" };
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : null;
    if (status !== null && [400, 409, 501].includes(status)) {
      journal.delete(receiptKey);
      persist();
      return {
        status: "rejected",
        error: error instanceof Error ? error.message : "操作未执行。",
      };
    }
    journal.set(receiptKey, "uncertain");
    persist();
    return {
      status: "uncertain",
      error: "无法确认操作结果，请检查当前状态；不会重复发送。",
    };
  }
}
export async function checkLogout(
  request: AccountMutationRequest & { operation: "logout" },
): Promise<AccountMutationResult> {
  try {
    // Account equality is intentionally not required after logout: only an
    // authoritative same-runtime null account can settle the ambiguous receipt.
    const live = await accountRuntime();
    if (
      live.source !== request.owner.source ||
      live.instance !== request.owner.instance
    )
      return { status: "uncertain" };
    const response = await postJsonWithOptions<{ account: Account | null }>(
      "/api/codex/account/get",
      { refreshToken: false },
      { suppressToast: true },
    );
    const after = await accountRuntime();
    if (
      after.source === request.owner.source &&
      after.instance === request.owner.instance &&
      response.account === null
    ) {
      journal.set(key(request), "complete");
      persist();
      return { status: "complete" };
    }
  } catch {
    /* An unavailable read never proves a successful logout. */
  }
  return {
    status: "uncertain",
    error: "无法确认操作结果，请检查当前状态；不会重复发送。",
  };
}
