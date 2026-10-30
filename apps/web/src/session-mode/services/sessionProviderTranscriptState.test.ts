import { beforeEach, expect, it, vi } from "vitest";
import {
  providerTranscriptKey,
  retainProviderTranscript,
  markProviderTranscriptDormant,
  providerTranscriptGeneration,
  canPublishProviderTranscript,
  useProviderTranscriptStore,
  forgetProviderTranscript,
  retainExternalTranscriptBody,
} from "./sessionProviderTranscriptState";
beforeEach(() => useProviderTranscriptStore.setState({ entries: {} }));

it("fences delayed history after reclamation and preserves the restore requirement on a new visible lifetime", () => {
  const owner = providerTranscriptKey("cc", "same-session");
  const release = retainProviderTranscript(owner, "cc", "same-session");
  const before = providerTranscriptGeneration(owner);
  release();
  markProviderTranscriptDormant(owner, 8192);
  expect(canPublishProviderTranscript(owner, before)).toBe(false);
  const returned = retainProviderTranscript(owner, "cc", "same-session");
  expect(
    useProviderTranscriptStore.getState().entries[owner].restoreNeeded,
  ).toBe(true);
  expect(canPublishProviderTranscript(owner, before)).toBe(false);
  expect(
    canPublishProviderTranscript(owner, providerTranscriptGeneration(owner)),
  ).toBe(true);
  returned();
});
it("charges only visible external bytes and removes its metadata lifetime on close", () => {
  const body = retainExternalTranscriptBody("receipt-viewer", "thread");
  body.report(1024 * 1024);
  expect(
    useProviderTranscriptStore.getState().entries["external:receipt-viewer"],
  ).toMatchObject({
    kind: "auxiliary",
    consumers: 1,
    externalBodyBytes: 1024 * 1024,
  });
  expect(() => body.report(Number.NaN)).toThrow(/Invalid/);
  body.dispose();
  body.report(1024);
  expect(
    useProviderTranscriptStore.getState().entries["external:receipt-viewer"],
  ).toBeUndefined();
});

it("uses exact ACP agent, connection and session context as the body identity", () => {
  expect(
    providerTranscriptKey("acp", "session", "agent-a", "connection-a"),
  ).not.toBe(
    providerTranscriptKey("acp", "session", "agent-b", "connection-a"),
  );
  expect(
    providerTranscriptKey("acp", "session", "agent-a", "connection-a"),
  ).not.toBe(
    providerTranscriptKey("acp", "session", "agent-a", "connection-b"),
  );
});

it("cannot accept an old read after unfollow and immediate refollow of the same session", () => {
  const owner = providerTranscriptKey("cc", "reopened");
  retainProviderTranscript(owner, "cc", "reopened")();
  const old = providerTranscriptGeneration(owner);
  forgetProviderTranscript(owner);
  expect(canPublishProviderTranscript(owner, old)).toBe(false);
  const release = retainProviderTranscript(owner, "cc", "reopened");
  expect(canPublishProviderTranscript(owner, old)).toBe(false);
  release();
});

it("counts two independent visible detail consumers of the same owner and releases only each consumer bytes", () => {
  const first = retainExternalTranscriptBody("same-viewer", "source"),
    second = retainExternalTranscriptBody("same-viewer", "source");
  first.report(100);
  second.report(200);
  expect(
    useProviderTranscriptStore.getState().entries["external:same-viewer"],
  ).toMatchObject({ consumers: 2, externalBodyBytes: 300 });
  first.dispose();
  expect(
    useProviderTranscriptStore.getState().entries["external:same-viewer"],
  ).toMatchObject({ consumers: 1, externalBodyBytes: 200 });
  second.report(220);
  expect(
    useProviderTranscriptStore.getState().entries["external:same-viewer"]
      .externalBodyBytes,
  ).toBe(220);
  second.dispose();
  expect(
    useProviderTranscriptStore.getState().entries["external:same-viewer"],
  ).toBeUndefined();
});
