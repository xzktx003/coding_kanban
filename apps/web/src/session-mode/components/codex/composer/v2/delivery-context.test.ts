import { expect, it } from "vitest";
import {
  beginDeliveryEcho,
  useCodexDeliveryStore,
} from "@session/stores/useCodexDeliveryStore";
it("context-only messages have a visible receipt while waiting for native history", () => {
  beginDeliveryEcho({
    id: "context-only",
    threadId: "thread",
    text: "",
    images: [],
    parameters: {},
    mode: "queue",
    contexts: [
      { id: "ref", kind: "quote", name: "引用", text: "完整引用内容" },
    ],
  });
  expect(
    Object.values(useCodexDeliveryStore.getState().entries).find(
      (e) => e.id === "context-only",
    )?.text,
  ).toContain("完整引用内容");
});
