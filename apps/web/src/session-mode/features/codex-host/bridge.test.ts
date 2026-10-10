import { beforeEach, expect, test, vi } from "vitest";
import {
  EditorHostBridge,
  addBrowserEditorContext,
  hostRequest,
} from "./bridge";
import {
  composerDrafts,
  useComposerDraftStore,
} from "@session/components/codex/composer/v2/drafts";
const owner = { cwd: "/project", threadId: "thread-a", draftOwner: "draft-a" };
beforeEach(() => useComposerDraftStore.setState({ drafts: {}, error: null }));
test("the mounted iframe source, origin, version, nonce and captured owner are all mandatory", () => {
  const source = { postMessage: vi.fn() } as unknown as Window;
  const frame = { contentWindow: source } as HTMLIFrameElement;
  const bridge = new EditorHostBridge(frame, owner, "nonce-a");
  const data = {
    channel: "coding-kanban.codex-host",
    version: 1,
    nonce: "nonce-a",
    owner,
    type: "context",
    payload: {
      path: "/project/a.ts",
      text: "unsaved selection",
      range: { start: 3, end: 4 },
    },
  };
  for (const overrides of [
    { source: window },
    { origin: "https://outside.invalid" },
    { data: { ...data, version: 2 } },
    { data: { ...data, nonce: "nonce-b" } },
    { data: { ...data, owner: { ...owner, threadId: "thread-b" } } },
  ])
    bridge.receive(
      new MessageEvent("message", {
        data,
        source,
        origin: location.origin,
        ...overrides,
      }),
    );
  expect(composerDrafts.read("draft-a").contexts).toHaveLength(0);
  bridge.receive(
    new MessageEvent("message", { data, source, origin: location.origin }),
  );
  expect(composerDrafts.read("draft-a").contexts[0]?.text).toBe(
    "unsaved selection",
  );
  expect(composerDrafts.read("draft-b").contexts).toHaveLength(0);
  bridge.dispose();
});
test("browser editor fallback writes the captured owner and rejects escaping context", () => {
  addBrowserEditorContext(owner, {
    path: "/project/a.ts",
    text: "captured",
    range: { start: 4, end: 5 },
  });
  expect(composerDrafts.read("draft-a").contexts[0]?.range).toEqual({
    start: 4,
    end: 5,
  });
  expect(() =>
    addBrowserEditorContext(owner, {
      path: "/project/../other/a.ts",
      text: "bad",
    }),
  ).toThrow();
});
test("the gateway's specific unavailable reason survives Fastify's generic status label", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: "Conflict", message: "原会话项目无法核验" },
        { status: 409 },
      ),
    ),
  );
  await expect(
    hostRequest("bind", { owner, nonce: "nonce-a" }),
  ).rejects.toThrow("原会话项目无法核验");
  vi.unstubAllGlobals();
});
