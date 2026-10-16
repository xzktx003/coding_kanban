import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  endpoint: "https://fixture.invalid",
  token: "fixture-a",
  fetch: vi.fn(),
}));
vi.mock("@session/hooks/runtime", () => ({
  buildUrl: (path: string) => mocks.endpoint + path,
  authHeaders: () => ({ Authorization: mocks.token }),
}));
import {
  materializeGoalDraft,
  readGoalObjective,
  isGoalSubmissionUncertain,
} from "./goalMaterialization";
import { SessionApiError } from "@session/services/apiAdapt/shared";
const prefix = "Read the Codex goal objective file at ";
const suffix = " before continuing.";
const empty = { objective: "", images: [], mentions: [] };
const id = "11111111-1111-4111-8111-111111111111";
const token = "a".repeat(64);
const receipt = (value: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => value,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.endpoint = "https://fixture.invalid";
  mocks.token = "fixture-a";
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

it("keeps short plain objectives local and counts Unicode codepoints", async () => {
  const objective = "😀".repeat(4000);
  expect(
    await materializeGoalDraft({ ...empty, objective: `  ${objective}\n` }),
  ).toEqual({ objective });
  expect(mocks.fetch).not.toHaveBeenCalled();
  await expect(materializeGoalDraft(empty)).rejects.toThrow(/empty/i);
});

it("captures all draft inputs and binds explicit cleanup to the original gateway and credentials", async () => {
  let finish!: (value: unknown) => void;
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const snapshot = {
    objective: "original",
    images: ["/private/uploads/captured.png"],
    pastedTexts: ["  original paste\n"],
    mentions: [{ name: "Plugin", path: "plugin://original@market" }],
  };
  const request = materializeGoalDraft(snapshot);
  snapshot.images[0] = "/private/uploads/changed.png";
  snapshot.pastedTexts[0] = "changed paste";
  snapshot.mentions[0].path = "plugin://changed@market";
  mocks.endpoint = "https://other.invalid";
  mocks.token = "fixture-b";
  finish(
    receipt({ objective: "materialized reference", cleanup: { id, token } }),
  );
  const result = await request;
  expect(result.objective).toBe("materialized reference");
  expect(mocks.fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({
    objective: "original",
    images: ["/private/uploads/captured.png"],
    pastedTexts: ["  original paste\n"],
    mentions: [{ name: "Plugin", path: "plugin://original@market" }],
  });
  mocks.fetch.mockResolvedValueOnce(receipt({ ok: true }));
  await result.cleanup?.();
  expect(mocks.fetch.mock.calls[1]).toEqual([
    "https://fixture.invalid/goal-attachments/cleanup",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "fixture-a",
      },
      body: JSON.stringify({ id, token }),
    },
  ]);
});

it("materializes long objectives, image-only, paste-only and typed mention snapshots", async () => {
  for (const value of [
    { objective: "😀".repeat(4001) },
    { images: ["https://example.invalid/one.png"] },
    { pastedTexts: ["literal text"] },
    { mentions: [{ name: "Worker", path: "agent://worker" }] },
  ]) {
    mocks.fetch.mockResolvedValueOnce(
      receipt({ objective: "native-compatible reference" }),
    );
    expect((await materializeGoalDraft({ ...empty, ...value })).objective).toBe(
      "native-compatible reference",
    );
  }
  expect(mocks.fetch).toHaveBeenCalledTimes(4);
});

it("does not automatically clean up on success, HTTP refusal, lost response or malformed receipt", async () => {
  for (const response of [
    receipt({ error: "rejected" }, 400),
    receipt({}),
    receipt({ objective: "x".repeat(4001) }),
    receipt({ objective: "wrapped", cleanup: { id: "../escape", token } }),
  ]) {
    mocks.fetch.mockResolvedValueOnce(response);
    await expect(
      materializeGoalDraft({ ...empty, objective: "x".repeat(4001) }),
    ).rejects.toThrow();
  }
  mocks.fetch.mockRejectedValueOnce(new TypeError("network lost"));
  await expect(
    materializeGoalDraft({ ...empty, images: ["/captured.png"] }),
  ).rejects.toThrow("network lost");
  expect(
    mocks.fetch.mock.calls.every(([url]) => url.endsWith("/materialize")),
  ).toBe(true);
});

it("cleanup errors remain visible and retryable instead of being swallowed", async () => {
  mocks.fetch.mockResolvedValueOnce(
    receipt({ objective: "reference", cleanup: { id, token } }),
  );
  const result = await materializeGoalDraft({
    ...empty,
    objective: "x".repeat(4001),
  });
  mocks.fetch.mockResolvedValueOnce(
    receipt({ error: "cleanup unavailable" }, 503),
  );
  await expect(result.cleanup?.()).rejects.toThrow("cleanup unavailable");
  mocks.fetch.mockResolvedValueOnce(receipt({ ok: true }));
  await expect(result.cleanup?.()).resolves.toBeUndefined();
});

it("reads only wrapped objectives through the constrained endpoint and forwards cancellation", async () => {
  expect(await readGoalObjective("ordinary objective")).toBe(
    "ordinary objective",
  );
  expect(mocks.fetch).not.toHaveBeenCalled();
  const objective = `${prefix}/private/goal-attachments/${id}/goal-objective.md${suffix}`;
  const controller = new AbortController();
  mocks.fetch.mockResolvedValueOnce(
    receipt({ objective: "full objective and all references" }),
  );
  expect(await readGoalObjective(objective, controller.signal)).toBe(
    "full objective and all references",
  );
  expect(mocks.fetch.mock.calls[0][0]).toBe(
    "https://fixture.invalid/goal-attachments/read",
  );
  expect(mocks.fetch.mock.calls[0][1].signal).toBe(controller.signal);
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({ objective });
});

it("preserves files for unknown delivery and permits cleanup only for explicit request rejection", () => {
  expect(isGoalSubmissionUncertain(new SessionApiError("refused", 409))).toBe(
    false,
  );
  expect(
    isGoalSubmissionUncertain(
      new SessionApiError("not admitted", 503, undefined, "not-admitted"),
    ),
  ).toBe(false);
  for (const error of [
    new Error("timeout"),
    new DOMException("Aborted", "AbortError"),
    new SessionApiError("internal error", 500),
    new SessionApiError("unknown", 400, undefined, "outcome-unknown"),
    { status: 400 },
  ]) {
    expect(isGoalSubmissionUncertain(error)).toBe(true);
  }
});

it("discarded read requests cannot restore a late objective after cancellation", async () => {
  let finish!: (value: unknown) => void;
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  const reading = readGoalObjective(
    `${prefix}/private/goal-attachments/${id}/goal-objective.md${suffix}`,
    controller.signal,
  );
  controller.abort();
  finish(receipt({ objective: "late objective" }));
  await expect(reading).rejects.toMatchObject({ name: "AbortError" });
});

it("concurrent cleanup shares one request and an acknowledged cleanup remains idempotent", async () => {
  mocks.fetch.mockResolvedValueOnce(
    receipt({ objective: "reference", cleanup: { id, token } }),
  );
  const result = await materializeGoalDraft({
    ...empty,
    objective: "x".repeat(4001),
  });
  let finish!: (value: unknown) => void;
  mocks.fetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const a = result.cleanup?.();
  const b = result.cleanup?.();
  expect(a).toBe(b);
  finish(receipt({ ok: true }));
  await a;
  await result.cleanup?.();
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
});
