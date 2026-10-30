import { beforeEach, expect, it } from "vitest";
import { beginDeliveryEcho, reconcileDeliveryEchoes, useCodexDeliveryStore } from "./useCodexDeliveryStore";

beforeEach(() => useCodexDeliveryStore.setState({ entries: {} }));
it("official acceptance metadata removes an optimistic echo without creating an empty transcript message", () => {
  beginDeliveryEcho({ id: "accepted", threadId: "t", text: "original draft", images: [], parameters: {}, mode: "queue" });
  reconcileDeliveryEchoes("t", { authority: "native", revision: 1, paused: null, items: [{ id: "accepted", threadId: "t", text: "", images: [], parameters: {}, mode: "queue", status: "sent", receiptOnly: true, fingerprint: "accepted", createdAt: 0 }] });
  expect(useCodexDeliveryStore.getState().entries).toEqual({});
});
it("replayed native receipt metadata never resurrects a user message deleted or rolled back elsewhere", () => {
  reconcileDeliveryEchoes("t", { authority: "native", revision: 2, paused: null, items: [{ id: "accepted", threadId: "t", text: "", images: [], parameters: {}, mode: "queue", status: "sent", receiptOnly: true, fingerprint: "accepted", createdAt: 0 }] });
  expect(useCodexDeliveryStore.getState().entries).toEqual({});
});
