import { beforeEach, expect, test } from "vitest";
import {
  parseSessionWindowRecord,
  SESSION_WINDOW_INTENTS,
  writeSessionWindowIntent,
  type SessionWindowRecord,
} from "./sessionWindowRecords";
const record = (): SessionWindowRecord => ({
  version: 1,
  id: "40bd1159-560e-4977-b808-b32aaf93265c",
  createdAt: Date.now(),
  endpoint: "https://fixture.invalid/api/session/health",
  target: { kind: "codex", id: "thread", cwd: "/private/project" },
  status: "ready",
  authority: {
    runtimeInstance: "owned-runtime",
    codexNamespace: "native-account",
  },
});
beforeEach(() => localStorage.clear());
test("launch metadata contains bounded identities and no transcript, credential or scope token", () => {
  const value = record();
  writeSessionWindowIntent(value);
  const raw = localStorage.getItem(SESSION_WINDOW_INTENTS + value.id)!;
  expect(parseSessionWindowRecord(raw, value.id)).toEqual(value);
  expect(raw).not.toMatch(/scopeToken|Authorization|password|draft|body/);
});
test("wrong nonce, missing authority and oversized metadata fail closed", () => {
  const value = record();
  expect(() =>
    parseSessionWindowRecord(JSON.stringify(value), "different-window"),
  ).toThrow(/无效/);
  expect(() =>
    parseSessionWindowRecord(
      JSON.stringify({ ...value, authority: undefined }),
      value.id,
    ),
  ).toThrow(/来源/);
  expect(() => parseSessionWindowRecord("x".repeat(8193), value.id)).toThrow(
    /预算/,
  );
});

test("reading an old or untrusted launch record never carries extra credential/body fields into accepted metadata", () => {
  const value = record();
  const parsed = parseSessionWindowRecord(
    JSON.stringify({
      ...value,
      authToken: "DO_NOT_COPY",
      body: "PRIVATE_BODY",
      target: { ...value.target, draft: "PRIVATE_DRAFT" },
      authority: { ...value.authority, scopeToken: "DO_NOT_COPY_SCOPE" },
    }),
    value.id,
  );
  expect(parsed).toEqual(value);
});
test("stale launch intents are reclaimed but active windows are not a functional count limit", () => {
  for (let n = 0; n < 16; n++) {
    const value = {
      ...record(),
      id: "old-" + n,
      createdAt: Date.now() - 121_000,
    };
    localStorage.setItem(
      SESSION_WINDOW_INTENTS + value.id,
      JSON.stringify(value),
    );
  }
  const value = record();
  writeSessionWindowIntent(value);
  expect(
    Object.keys(localStorage).filter((key) =>
      key.startsWith(SESSION_WINDOW_INTENTS),
    ),
  ).toEqual([SESSION_WINDOW_INTENTS + value.id]);
});
