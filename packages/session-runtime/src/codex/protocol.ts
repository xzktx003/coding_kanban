import { isDeepStrictEqual } from "node:util";
import { HistoryBudget, type HistoryBudgetLimits } from "../core/history-budget.js";
import { sanitizeCodexHistory } from "./projection.js";
import { bodyObject, HttpError, isObject, object, type Json, type JsonObject } from "../core/json.js";
import { RpcError } from "../transport/rpc.js";
import type { Rpc } from "./ownership.js";

function exactKeys(value: Json, keys: string[], message: string): JsonObject {
  const body = bodyObject(value);
  if (Object.keys(body).length !== keys.length || keys.some(key => !(key in body))) throw new HttpError(400, message);
  return body;
}
function empty(value: Json): void {
  if (!isObject(value) || Object.keys(value).length) throw new HttpError(400, "This readonly endpoint accepts an empty object only");
}
export function boundedText(value: unknown, max: number, field: string, controls = false): string {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > max || value.includes("\0") ||
      (controls && /[\x00-\x1f\x7f-\x9f]/.test(value))) throw new HttpError(400, `Invalid ${field}`);
  return value;
}
function choice(value: Json | undefined, choices: string[]): Json { return typeof value === "string" && choices.includes(value) ? value : null; }
function permission(value: Json | undefined): Json {
  return typeof value === "string" && value.length <= 160 && /^[\w\-_: .]+$/.test(value) ? value : null;
}
function approval(value: Json | undefined): Json {
  if (typeof value === "string") return choice(value, ["untrusted", "on-request", "never"]);
  const granular = object(object(value).granular);
  const keys = ["sandbox_approval", "rules", "skill_approval", "request_permissions", "mcp_elicitations"];
  if (keys.some(key => typeof granular[key] !== "boolean")) return null;
  return { granular: Object.fromEntries(keys.map(key => [key, granular[key]])) };
}
const reviewer = (value: Json | undefined) => choice(value, ["user", "auto_review", "guardian_subagent"]);
const sandbox = (value: Json | undefined) => choice(value, ["read-only", "workspace-write", "danger-full-access"]);

export async function readConfig(params: Json, request: Rpc): Promise<JsonObject> {
  empty(params);
  const raw = object(await request("config/read", { includeLayers: false }));
  if (!isObject(raw.config)) throw new Error("Invalid native config response");
  return { config: { approvals_reviewer: reviewer(raw.config.approvals_reviewer), approval_policy: approval(raw.config.approval_policy),
    sandbox_mode: sandbox(raw.config.sandbox_mode), permissions: permission(raw.config.permissions) } };
}
export async function readRequirements(params: Json, request: Rpc): Promise<JsonObject> {
  empty(params);
  const raw = object(await request("configRequirements/read", null));
  if (raw.requirements === null) return { requirements: null };
  if (!isObject(raw.requirements)) throw new Error("Invalid native requirements");
  const requirements = raw.requirements;
  const array = (key: string, project: (value: Json) => Json) => Array.isArray(requirements[key]) ? requirements[key].map(project).filter(v => v !== null) : null;
  return { requirements: {
    allowedApprovalPolicies: array("allowedApprovalPolicies", approval),
    allowedApprovalsReviewers: array("allowedApprovalsReviewers", reviewer),
    allowedSandboxModes: array("allowedSandboxModes", sandbox),
    allowedPermissionProfiles: isObject(requirements.allowedPermissionProfiles) ? Object.fromEntries(
      Object.entries(requirements.allowedPermissionProfiles).filter(([key, value]) => permission(key) !== null && typeof value === "boolean")) : null,
    defaultPermissions: permission(requirements.defaultPermissions),
  } };
}

export async function searchOccurrences(params: Json, request: Rpc): Promise<Json> {
  const input = bodyObject(params);
  if (Object.keys(input).some(key => !["threadId", "searchTerm", "cursor", "limit"].includes(key))) throw new HttpError(400, "Unknown search parameter");
  const output: JsonObject = { threadId: boundedText(input.threadId, 512, "threadId", true), searchTerm: boundedText(input.searchTerm, 8192, "searchTerm") };
  if ("cursor" in input) output.cursor = input.cursor === null ? null : boundedText(input.cursor, 65536, "cursor");
  if ("limit" in input) {
    if (input.limit !== null && (!Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 250)) throw new HttpError(400, "limit must be an integer from 1 to 250");
    output.limit = input.limit;
  }
  return request("thread/searchOccurrences", output);
}

function publicAccount(value: Json | undefined): JsonObject {
  const account = object(value);
  if (account.type === "apiKey") return { type: "apiKey" };
  if (account.type === "chatgpt") {
    if (account.email !== null && (typeof account.email !== "string" || Buffer.byteLength(account.email) > 512 || /[\x00-\x1f\x7f-\x9f]/.test(account.email))) throw new HttpError(400, "Unknown public account email");
    const plans = ["free", "go", "plus", "pro", "prolite", "team", "self_serve_business_usage_based", "business", "ent26", "enterprise_cbp_usage_based", "enterprise", "edu", "unknown"];
    if (typeof account.planType !== "string" || !plans.includes(account.planType)) throw new HttpError(400, "Unknown public account plan");
    return { type: "chatgpt", email: account.email, planType: account.planType };
  }
  if (account.type === "amazonBedrock" && typeof account.usesCodexManagedCredentials === "boolean")
    return { type: "amazonBedrock", usesCodexManagedCredentials: account.usesCodexManagedCredentials };
  throw new HttpError(400, "Unknown current public account snapshot");
}
function requireInstance(value: Json, current: string): void {
  const captured = boundedText(value, 512, "runtimeInstance", true);
  if (captured !== current) throw new Error("SESSION_AUTH_SCOPE_CHANGED: runtime instance changed; account action was not sent");
}
export async function cancelLogin(params: Json, instance: string, request: Rpc): Promise<JsonObject> {
  const body = exactKeys(params, ["runtimeInstance", "loginId"], "Cancel requires captured runtimeInstance and loginId only");
  const loginId = boundedText(body.loginId, 512, "loginId", true);
  if (!loginId.trim()) throw new HttpError(400, "Invalid loginId");
  requireInstance(body.runtimeInstance, instance);
  const result = object(await request("account/login/cancel", { loginId }));
  if (result.status !== "canceled" && result.status !== "notFound") throw new Error("DELIVERY_UNKNOWN: invalid native cancel receipt; do not retry automatically");
  return { status: result.status };
}
export async function logout(params: Json, instance: string, request: Rpc): Promise<JsonObject> {
  const body = exactKeys(params, ["runtimeInstance", "expectedAccount"], "Logout requires runtimeInstance and expectedAccount only");
  const expected = publicAccount(body.expectedAccount);
  if (!isDeepStrictEqual(expected, body.expectedAccount)) throw new HttpError(400, "Expected account must be the exact minimal public snapshot");
  requireInstance(body.runtimeInstance, instance);
  const response = object(await request("account/read", { refreshToken: false }));
  let current: JsonObject;
  try { current = publicAccount(response.account); }
  catch { throw new Error("SESSION_AUTH_SCOPE_CHANGED: current account snapshot is unknown; logout was not sent"); }
  if (!isDeepStrictEqual(current, expected)) throw new Error("SESSION_AUTH_SCOPE_CHANGED: public account snapshot changed; logout was not sent");
  const result = await request("account/logout", null);
  if (!isObject(result) || Object.keys(result).length) throw new Error("DELIVERY_UNKNOWN: invalid native logout receipt; do not retry automatically");
  return {};
}

export function unsupported(error: unknown, methods: string[]): boolean {
  return error instanceof RpcError && (error.code === -32601 ||
    error.code === -32600 && /unknown variant|unknown method/.test(error.message) && methods.some(method => error.message.includes(method)));
}

async function retainedTurns(id: string, initialCursor: Json, request: Rpc, limits: Partial<HistoryBudgetLimits> = {}, initial?: Json): Promise<Json[]> {
  const budget = new HistoryBudget(limits);
  if (initial !== undefined) budget.add(initial);
  const turns: Json[] = [], seen = new Set<string>(); let cursor = initialCursor;
  while (true) {
    if (typeof cursor === "string") { if (seen.has(cursor)) throw new Error("Repeated Codex history cursor"); seen.add(cursor); }
    else if (cursor !== null) throw new Error("Invalid Codex history cursor");
    budget.beginPage();
    const page = object(await request("thread/turns/list", { threadId: id, cursor, limit: 100, sortDirection: "desc", itemsView: "full" }));
    budget.add(page);
    if (!Array.isArray(page.data)) throw new Error("Invalid Codex turns page");
    for (const turn of sanitizeCodexHistory(page.data)) turns.push(turn);
    if (!("nextCursor" in page)) throw new Error("Missing Codex history cursor");
    cursor = page.nextCursor;
    if (cursor === null) break;
  }
  return turns.reverse();
}
function rollbackReloadFailure(error: unknown): Error {
  return new Error(`对话历史已回滚，但重新加载失败，请重新打开会话，不要重复回滚：${error instanceof Error ? error.message : error}`);
}
export async function rollback(params: Json, request: Rpc, limits: Partial<HistoryBudgetLimits> = {}): Promise<Json> {
  const body = bodyObject(params);
  const threadId = boundedText(body.threadId, 512, "threadId", true), numTurns = body.numTurns;
  if (!Number.isInteger(numTurns) || Number(numTurns) < 1 || Number(numTurns) > 0xffffffff) throw new HttpError(400, "numTurns must be a positive integer");
  // Validate local budget configuration before sending any destructive native operation.
  new HistoryBudget(limits);
  try {
    const result = await request("thread/rollback", { threadId, numTurns });
    try { const budget = new HistoryBudget(limits); budget.beginPage(); budget.add(result); return sanitizeCodexHistory(result); }
    catch (error) { throw rollbackReloadFailure(error); }
  }
  catch (error) { if (!unsupported(error, ["thread/rollback"])) throw error; }
  let beforeTurnId: string;
  if (body.beforeTurnId === undefined || body.beforeTurnId === null) {
    const turns = await retainedTurns(threadId, null, request, limits);
    const index = turns.length - Number(numTurns);
    if (index < 0) throw new Error("Rollback exceeds available turns");
    beforeTurnId = boundedText(object(turns[index]).id, 512, "turn id", true);
  } else beforeTurnId = boundedText(body.beforeTurnId, 512, "beforeTurnId", true);
  const result = object(await request("thread/revert", { threadId, beforeTurnId }));
  try {
    if (!("turnsBackwardsCursor" in result) || !isObject(result.thread)) throw new Error("Invalid reverted thread or cursor");
    if (result.turnsBackwardsCursor === null) { const budget = new HistoryBudget(limits); budget.add(result); result.thread.turns = []; }
    else result.thread.turns = await retainedTurns(threadId, result.turnsBackwardsCursor, request, limits, result);
    return sanitizeCodexHistory(result);
  } catch (error) { throw rollbackReloadFailure(error); }
}
