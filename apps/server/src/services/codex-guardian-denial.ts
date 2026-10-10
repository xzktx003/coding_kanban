import { createHash, createHmac, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  GuardianDenialApproveRequest,
  GuardianDenialResult,
  GuardianDenialSnapshot,
  GuardianReviewIdentity,
} from "@agent-orchestrator/shared";
import { writeDurableJson } from "./durable-json.js";

/** Supplied by a trusted runtime bridge, never from browser/v2 reconstruction.
 * instanceMarker must identify this exact raw review, including any replacement.
 */
export interface GuardianNativeSnapshot {
  runtimeInstance: string;
  instanceMarker: string;
  threadId: string;
  latestTurnId: string;
  featureEnabled: boolean | null;
  canAcceptDirectInput: boolean | null;
  recorded: boolean;
  review: Record<string, unknown> | null;
  event: Record<string, unknown> | null;
}
export interface GuardianDenialDependencies {
  read: (
    identity: GuardianReviewIdentity,
  ) => Promise<GuardianNativeSnapshot | null>;
  send: (
    method: "thread/approveGuardianDeniedAction",
    params: { threadId: string; event: Record<string, unknown> },
    runtimeInstance: string,
  ) => Promise<"recorded" | "rejected">;
}
interface Receipt {
  fingerprint: string;
  result: GuardianDenialResult;
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function key(identity: GuardianReviewIdentity) {
  return stable(identity);
}
function fail(message: string, statusCode = 409): never {
  throw Object.assign(new Error(message), { statusCode });
}
function publicAction(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const types: Record<string, string> = {
    command: "command",
    execve: "execve",
    apply_patch: "applyPatch",
    network_access: "networkAccess",
    mcp_tool_call: "mcpToolCall",
    request_permissions: "requestPermissions",
  };
  const type = typeof raw.type === "string" ? types[raw.type] : undefined;
  if (!type) return null;
  const camelKeys = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(camelKeys);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input).map(([k, v]) => [
          k.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          camelKeys(v),
        ]),
      );
    return input;
  };
  const projected = camelKeys(raw) as Record<string, unknown>;
  projected.type = type;
  if (projected.source === "unified_exec") projected.source = "unifiedExec";
  return projected;
}
function matches(
  identity: GuardianReviewIdentity,
  native: GuardianNativeSnapshot,
): boolean {
  const review = native.review,
    raw = native.event;
  const status = review?.review as Record<string, unknown> | undefined;
  return Boolean(
    native.runtimeInstance &&
    native.instanceMarker &&
    native.threadId === identity.threadId &&
    native.latestTurnId === identity.turnId &&
    review &&
    raw &&
    Object.entries(identity).every(([k, v]) => review[k] === v) &&
    review.decisionSource === "agent" &&
    status?.status === "denied" &&
    raw.id === identity.reviewId &&
    raw.turn_id === identity.turnId &&
    (raw.target_item_id ?? null) === identity.targetItemId &&
    raw.started_at_ms === identity.startedAtMs &&
    raw.completed_at_ms === identity.completedAtMs &&
    raw.status === "denied" &&
    raw.decision_source === "agent" &&
    (raw.risk_level ?? null) === (status.riskLevel ?? null) &&
    (raw.user_authorization ?? null) === (status.userAuthorization ?? null) &&
    (raw.rationale ?? null) === (status.rationale ?? null) &&
    publicAction(raw.action) !== null &&
    stable(publicAction(raw.action)) === stable(review.action),
  );
}
const digest = (value: unknown) =>
  createHash("sha256").update(stable(value)).digest("hex");

/** Records permission for one retry; does not execute, resume or start a turn.
 * A durable pending receipt is written BEFORE sending. Unknown delivery remains
 * blocked across hot reloads; only a trusted read-only recorded receipt settles it.
 */
export class CodexGuardianDenial {
  private readonly secret = randomBytes(32);
  private receipts = new Map<string, Receipt>();
  private serial: Promise<unknown> = Promise.resolve();
  private loaded = false;
  constructor(
    private readonly deps?: GuardianDenialDependencies,
    private readonly file?: string,
  ) {}
  private async load() {
    if (this.loaded) return;
    if (this.file) {
      try {
        const value = JSON.parse(await readFile(this.file, "utf8")) as {
          version: number;
          receipts: Array<[string, Receipt]>;
        };
        if (value.version !== 1 || !Array.isArray(value.receipts))
          fail("Guardian approval journal is invalid", 503);
        this.receipts = new Map(value.receipts);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    this.loaded = true;
  }
  private save() {
    return this.file
      ? writeDurableJson(this.file, {
          version: 1,
          receipts: [...this.receipts],
        })
      : Promise.resolve();
  }
  private async lease(): Promise<() => void> {
    if (!this.file) return () => {};
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    return new Promise((resolve, reject) => {
      const child = spawn(
        "flock",
        [
          "-w",
          "20",
          this.file + ".lock",
          process.execPath,
          "-e",
          "process.stdout.write('locked');process.stdin.resume()",
        ],
        { stdio: ["pipe", "pipe", "ignore"] },
      );
      let acquired = false;
      child.once("error", reject);
      child.stdout.once("data", () => {
        acquired = true;
        resolve(() => child.stdin.end());
      });
      child.once("exit", () => {
        if (!acquired)
          reject(
            Object.assign(new Error("Guardian approval journal is busy"), {
              statusCode: 503,
            }),
          );
      });
    });
  }
  private run<T>(work: () => Promise<T>) {
    const next = this.serial.then(async () => {
      const release = await this.lease();
      try {
        if (this.file) {
          this.loaded = false;
          this.receipts.clear();
        }
        await this.load();
        return await work();
      } finally {
        release();
      }
    });
    this.serial = next.catch(() => {});
    return next;
  }
  private fingerprint(native: GuardianNativeSnapshot) {
    return digest({
      runtimeInstance: native.runtimeInstance,
      instanceMarker: native.instanceMarker,
      review: native.review,
      event: native.event,
    });
  }
  private token(
    identity: GuardianReviewIdentity,
    native: GuardianNativeSnapshot,
  ) {
    return createHmac("sha256", this.secret)
      .update(key(identity))
      .update(this.fingerprint(native))
      .digest("hex");
  }
  private async read(identity: GuardianReviewIdentity) {
    return this.deps ? await this.deps.read(structuredClone(identity)) : null;
  }
  private async getSnapshot(
    identity: GuardianReviewIdentity,
  ): Promise<GuardianDenialSnapshot> {
    const native = await this.read(identity);
    const snapshot: GuardianDenialSnapshot = {
      identity: structuredClone(identity),
      runtimeInstance: native?.runtimeInstance ?? null,
      approvalToken: null,
      canApprove: false,
      canAcceptDirectInput: native?.canAcceptDirectInput ?? null,
      state: "unavailable",
      review: native?.review ? structuredClone(native.review) : null,
    };
    if (!native || !matches(identity, native)) return snapshot;
    const fingerprint = this.fingerprint(native),
      receipt = this.receipts.get(key(identity));
    if (native.recorded) {
      if (
        receipt?.fingerprint === fingerprint &&
        receipt.result.state !== "recorded"
      ) {
        receipt.result.state = "recorded";
        await this.save();
      }
      return { ...snapshot, state: "recorded" };
    }
    // An unresolved operation is tied to the review lifecycle, including across
    // runtime replacement; a new gateway must not convert it into a new grant.
    if (receipt) return { ...snapshot, state: receipt.result.state };
    if (native.featureEnabled !== true || native.canAcceptDirectInput !== true)
      return snapshot;
    return {
      ...snapshot,
      approvalToken: this.token(identity, native),
      canApprove: true,
      state: "available",
    };
  }
  snapshot(identity: GuardianReviewIdentity) {
    return this.run(() => this.getSnapshot(identity));
  }
  async approve(
    input: GuardianDenialApproveRequest,
  ): Promise<GuardianDenialResult> {
    // Fast path also prevents waiting behind a live request then resending.
    const live = this.receipts.get(key(input.identity));
    if (live && live.result.runtimeInstance === input.runtimeInstance)
      return structuredClone(live.result);
    let dispatch: { native: GuardianNativeSnapshot; receipt: Receipt } | null =
      null;
    const preflight = await this.run(async () => {
      const native = await this.read(input.identity);
      if (
        !native ||
        !matches(input.identity, native) ||
        native.runtimeInstance !== input.runtimeInstance ||
        this.token(input.identity, native) !== input.approvalToken
      )
        fail("Guardian review instance changed; approval was not sent");
      const previous = this.receipts.get(key(input.identity));
      if (previous) return structuredClone(previous.result);
      if (native.recorded)
        return {
          identity: structuredClone(input.identity),
          runtimeInstance: input.runtimeInstance,
          clientRequestId: input.clientRequestId,
          state: "recorded" as const,
        };
      if (
        native.featureEnabled !== true ||
        native.canAcceptDirectInput !== true
      )
        fail(
          "Guardian approval capability is unavailable; approval was not sent",
        );
      const receipt: Receipt = {
        fingerprint: this.fingerprint(native),
        result: {
          identity: structuredClone(input.identity),
          runtimeInstance: input.runtimeInstance,
          clientRequestId: input.clientRequestId,
          state: "uncertain",
        },
      };
      this.receipts.set(key(input.identity), receipt);
      await this.save();
      dispatch = { native: structuredClone(native), receipt };
      return null;
    });
    if (preflight) return preflight;
    const captured = dispatch as {
      native: GuardianNativeSnapshot;
      receipt: Receipt;
    } | null;
    if (!captured || !captured.native.event || !this.deps)
      fail("Guardian approval capability is unavailable");
    let state: GuardianDenialResult["state"] = "uncertain";
    try {
      state = await this.deps.send(
        "thread/approveGuardianDeniedAction",
        { threadId: input.identity.threadId, event: captured.native.event },
        captured.native.runtimeInstance,
      );
    } catch {
      /* Unknown delivery remains durable and cannot resend. */
    }
    return this.run(async () => {
      const receipt = this.receipts.get(key(input.identity));
      if (!receipt || receipt.fingerprint !== captured.receipt.fingerprint)
        fail("Guardian approval receipt changed", 503);
      // A trusted read-only receipt may have settled the original action while
      // the RPC response was still pending. Late transport failures cannot undo it.
      if (receipt.result.state !== "recorded") receipt.result.state = state;
      await this.save();
      return structuredClone(receipt.result);
    });
  }
}
