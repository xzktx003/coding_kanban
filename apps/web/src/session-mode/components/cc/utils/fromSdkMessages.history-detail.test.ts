import { expect, it } from "vitest";
import { fromSdkMessages } from "./fromSdkMessages";

it("preserves the exact readonly detail identity for both cropped SDK user and assistant messages", () => {
  const values = ["user", "assistant"].map(type => ({
    type, uuid: `${type}-native`, session_id: "session", truncated: true,
    historyDetail: { itemId: `${type}-source` },
    historyImages: [{ index: 1, mimeType: "image/png", url: "https://untrusted.invalid/never-fetch" }, { index: -1, mimeType: "image/png" }],
    message: { role: type, content: [{ type: "text", text: "bounded preview" }] },
  }));
  const messages = fromSdkMessages(values as any, "session");
  expect(messages.map(message => ({
    uuid: (message as { uuid?: string }).uuid, truncated: (message as any).truncated,
    historyDetail: (message as any).historyDetail,
    historyImages: (message as any).historyImages,
  }))).toEqual([
    { uuid: "user-native", truncated: true, historyDetail: { itemId: "user-source" }, historyImages: [{index:1,mimeType:"image/png"}] },
    { uuid: "assistant-native", truncated: true, historyDetail: { itemId: "assistant-source" }, historyImages: [{index:1,mimeType:"image/png"}] },
  ]);
});

it("does not invent a complete-content action for absent or malformed detail identities", () => {
  for (const historyDetail of [undefined, null, {}, { itemId: "" }, { itemId: 4 }]) {
    const [message] = fromSdkMessages([{ type: "assistant", uuid: "native", session_id: "session", message: { content: [] }, historyDetail } as any], "session");
    expect((message as any).historyDetail).toBeUndefined();
  }
});
