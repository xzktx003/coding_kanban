import type {
  GuardianDenialApproveRequest,
  GuardianDenialResult,
  GuardianDenialSnapshot,
  GuardianReviewIdentity,
} from "@agent-orchestrator/shared";
import type { ItemGuardianApprovalReviewCompletedNotification } from "@session/bindings/v2/ItemGuardianApprovalReviewCompletedNotification";
import { SessionApiError } from "@session/services/apiAdapt/shared";
export type GuardianDenialPhase =
  | "checking"
  | "available"
  | "approving"
  | "recorded"
  | "uncertain"
  | "rejected"
  | "unavailable";
export interface GuardianDenialState {
  state: GuardianDenialPhase;
  snapshot: GuardianDenialSnapshot | null;
  canApprove: boolean;
}
export interface GuardianDenialApi {
  snapshot: (
    identity: GuardianReviewIdentity,
  ) => Promise<GuardianDenialSnapshot>;
  approve: (
    input: GuardianDenialApproveRequest,
  ) => Promise<GuardianDenialResult>;
}
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};
const storageKey = "codex-guardian-deliveries-v1";
interface Delivery {
  identity: GuardianReviewIdentity;
  runtimeInstance: string;
  clientRequestId: string;
  state: "uncertain" | "recorded" | "rejected";
}
/** Per exact completed review. Read-only refresh never authorizes a resend after
 * an ambiguous HTTP response, even if the gateway still reports available.
 */
export class GuardianDenialController {
  readonly identity: GuardianReviewIdentity;
  private readonly review: ItemGuardianApprovalReviewCompletedNotification;
  private value: GuardianDenialState = {
    state: "checking",
    snapshot: null,
    canApprove: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private delivery: Delivery | null = null;
  private busy = false;
  constructor(
    review: ItemGuardianApprovalReviewCompletedNotification,
    private readonly api: GuardianDenialApi,
    private readonly storage?: Storage,
  ) {
    this.review = structuredClone(review);
    const {
      threadId,
      turnId,
      reviewId,
      targetItemId,
      startedAtMs,
      completedAtMs,
    } = review;
    this.identity = {
      threadId,
      turnId,
      reviewId,
      targetItemId,
      startedAtMs,
      completedAtMs,
    };
    try {
      const deliveries = JSON.parse(
        storage?.getItem(storageKey) ?? "{}",
      ) as Record<string, Delivery>;
      const previous = deliveries[stable(this.identity)];
      if (
        previous &&
        stable(previous.identity) === stable(this.identity) &&
        typeof previous.runtimeInstance === "string" &&
        typeof previous.clientRequestId === "string" &&
        ["uncertain", "recorded", "rejected"].includes(previous.state)
      ) {
        this.delivery = previous;
        this.value = { ...this.value, state: previous.state };
      }
    } catch {
      /* Native gateway receipt remains authoritative if storage is disabled. */
    }
  }
  getState = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private set(state: GuardianDenialPhase, snapshot = this.value.snapshot) {
    this.value = { state, snapshot, canApprove: state === "available" };
    this.listeners.forEach((listener) => listener());
  }
  private persist(delivery: Delivery) {
    this.delivery = delivery;
    try {
      const deliveries = JSON.parse(
        this.storage?.getItem(storageKey) ?? "{}",
      ) as Record<string, Delivery>;
      deliveries[stable(this.identity)] = delivery;
      this.storage?.setItem(storageKey, JSON.stringify(deliveries));
    } catch {
      /* Continue to block in memory and rely on durable server receipt. */
    }
  }
  private matches(snapshot: GuardianDenialSnapshot) {
    return (
      stable(snapshot.identity) === stable(this.identity) &&
      snapshot.review !== null &&
      stable(snapshot.review) === stable(this.review)
    );
  }
  private available(snapshot: GuardianDenialSnapshot) {
    return (
      this.review.review.status === "denied" &&
      this.review.decisionSource === "agent" &&
      this.matches(snapshot) &&
      snapshot.state === "available" &&
      snapshot.canApprove === true &&
      snapshot.canAcceptDirectInput === true &&
      typeof snapshot.runtimeInstance === "string" &&
      Boolean(snapshot.runtimeInstance) &&
      typeof snapshot.approvalToken === "string" &&
      /^[a-f0-9]{64}$/.test(snapshot.approvalToken)
    );
  }
  async load() {
    if (this.busy) return;
    const generation = ++this.generation;
    if (!this.delivery) this.set("checking");
    try {
      const snapshot = await this.api.snapshot(structuredClone(this.identity));
      if (generation !== this.generation || this.busy) return;
      if (this.delivery) {
        if (
          this.matches(snapshot) &&
          snapshot.runtimeInstance === this.delivery.runtimeInstance &&
          snapshot.state === "recorded"
        ) {
          this.persist({ ...this.delivery, state: "recorded" });
          this.set("recorded", snapshot);
        } else this.set(this.delivery.state, snapshot);
        return;
      }
      if (!this.matches(snapshot)) {
        this.set("unavailable", snapshot);
        return;
      }
      if (
        snapshot.state === "recorded" ||
        snapshot.state === "uncertain" ||
        snapshot.state === "rejected"
      )
        this.set(snapshot.state, snapshot);
      else
        this.set(
          this.available(snapshot) ? "available" : "unavailable",
          snapshot,
        );
    } catch {
      if (generation === this.generation && !this.busy)
        this.set(this.delivery?.state ?? "unavailable");
    }
  }
  async approve() {
    const previous = this.value.snapshot;
    if (
      this.busy ||
      this.value.state !== "available" ||
      !previous ||
      !this.available(previous) ||
      this.delivery
    )
      return;
    this.busy = true;
    ++this.generation;
    this.set("approving");
    try {
      const refreshed = await this.api.snapshot(structuredClone(this.identity));
      if (
        !this.available(refreshed) ||
        refreshed.runtimeInstance !== previous.runtimeInstance ||
        refreshed.approvalToken !== previous.approvalToken
      ) {
        this.set("unavailable", refreshed);
        return;
      }
      const input: GuardianDenialApproveRequest = {
        identity: structuredClone(this.identity),
        runtimeInstance: refreshed.runtimeInstance!,
        approvalToken: refreshed.approvalToken!,
        clientRequestId: crypto.randomUUID(),
      };
      this.persist({
        identity: structuredClone(this.identity),
        runtimeInstance: input.runtimeInstance,
        clientRequestId: input.clientRequestId,
        state: "uncertain",
      });
      try {
        const result = await this.api.approve(input);
        if (
          stable(result.identity) !== stable(input.identity) ||
          result.runtimeInstance !== input.runtimeInstance ||
          result.clientRequestId !== input.clientRequestId ||
          !["recorded", "uncertain", "rejected"].includes(result.state)
        ) {
          this.set("uncertain");
          return;
        }
        this.persist({ ...this.delivery!, state: result.state });
        this.set(result.state);
      } catch (error) {
        const rejected =
          error instanceof SessionApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408;
        this.persist({
          ...this.delivery!,
          state: rejected ? "rejected" : "uncertain",
        });
        this.set(rejected ? "rejected" : "uncertain");
      }
    } catch {
      this.set("unavailable");
    } finally {
      this.busy = false;
    }
  }
}
