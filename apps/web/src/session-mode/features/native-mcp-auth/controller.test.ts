import { expect, it, vi } from "vitest";
import { McpReauthentication } from "./controller";
function fixture(enabled = true) {
  const prompts: any[] = [],
    errors: any[] = [],
    opened: string[] = [];
  const deps = {
    startupEnabled: vi.fn(async () => enabled),
    inventory: vi.fn(async () => ({
      data: [{ name: "mcp", authStatus: "notLoggedIn" }],
      nextCursor: null,
    })),
    oauth: vi.fn(async (_p: any) => ({
      authorizationUrl: "https://example.invalid/auth",
    })),
    reload: vi.fn(async () => {}),
    open: (url: string) => opened.push(url),
    threadIdSupported: () => true,
    prompt: (
      name: string,
      reconnect: () => Promise<void>,
      dismiss: () => void,
      remove: () => void,
    ) => {
      const p = { name, reconnect, dismiss, close: vi.fn(() => remove()) };
      prompts.push(p);
      return p;
    },
    error: (kind: string, name: string) => errors.push({ kind, name }),
  };
  const controller = new McpReauthentication("identity-A", deps, new Map());
  return { controller, deps, prompts, errors, opened };
}
it("does not resurrect startup prompting when ready arrives while configuration is pending", async () => {
  const f = fixture();
  let finish!: (value: boolean) => void;
  f.deps.startupEnabled.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = f.controller.event("mcpServer/startupStatus/updated", {
    name: "mcp",
    status: "failed",
    failureReason: "reauthenticationRequired",
  });
  await f.controller.event("mcpServer/startupStatus/updated", {
    name: "mcp",
    status: "ready",
  });
  finish(true);
  await pending;
  expect(f.prompts).toHaveLength(0);
  f.controller.stop();
});
it("startup authentication defaults off; runtime challenge bypasses that startup switch", async () => {
  const f = fixture(false);
  await f.controller.refresh();
  expect(f.prompts).toHaveLength(0);
  await f.controller.event("mcpServer/startupStatus/updated", {
    name: "mcp",
    status: "failed",
    failureReason: "reauthenticationRequired",
    threadId: "A",
  });
  expect(f.prompts).toHaveLength(0);
  await f.controller.event("item/completed", {
    threadId: "A",
    item: {
      type: "mcpToolCall",
      server: "mcp",
      nativeMcpAuthChallenge: { scopes: ["read"] },
    },
  });
  expect(f.prompts).toHaveLength(1);
  await f.prompts[0].reconnect();
  expect(f.deps.oauth).toHaveBeenCalledWith(
    { name: "mcp", threadId: "A", scopes: ["read"] },
    expect.any(AbortSignal),
  );
  f.controller.stop();
});
it("dismissal suppresses startup prompting until another selected thread is rechecked", async () => {
  const f = fixture();
  await f.controller.refresh();
  expect(f.prompts).toHaveLength(1);
  f.prompts[0].dismiss();
  f.prompts[0].close();
  await f.controller.refresh();
  expect(f.prompts).toHaveLength(1);
  await f.controller.selectThread("B");
  expect(f.prompts).toHaveLength(2);
  f.controller.stop();
});
it("OAuth coalesces clicks, reopens a captured URL and reloads after success", async () => {
  const f = fixture();
  let resolve!: (v: any) => void;
  f.deps.oauth.mockImplementation(() => new Promise((r) => (resolve = r)));
  await f.controller.refresh();
  const a = f.prompts[0].reconnect(),
    b = f.prompts[0].reconnect();
  expect(f.deps.oauth).toHaveBeenCalledTimes(1);
  resolve({ authorizationUrl: "https://example.invalid/auth" });
  await Promise.all([a, b]);
  expect(f.opened).toHaveLength(1);
  await f.prompts[0].reconnect();
  expect(f.deps.oauth).toHaveBeenCalledTimes(1);
  expect(f.opened).toHaveLength(2);
  await f.controller.event("mcpServer/oauthLogin/completed", {
    name: "mcp",
    success: true,
  });
  expect(f.deps.reload).toHaveBeenCalledTimes(1);
  expect(f.prompts[0].close).toHaveBeenCalledTimes(1);
  f.controller.stop();
});
it("stale requests after identity disposal do not open a URL or resurrect notices", async () => {
  const f = fixture();
  let resolve!: (v: any) => void;
  f.deps.oauth.mockImplementation(() => new Promise((r) => (resolve = r)));
  await f.controller.refresh();
  const pending = f.prompts[0].reconnect();
  f.controller.stop();
  resolve({ authorizationUrl: "https://example.invalid/late" });
  await pending;
  expect(f.opened).toHaveLength(0);
  expect(f.errors).toHaveLength(0);
});
it("failure notices retain the prompt and can retry; unrelated completion failures are ignored", async () => {
  const f = fixture();
  await f.controller.event("mcpServer/oauthLogin/completed", {
    name: "other",
    success: false,
  });
  expect(f.errors).toHaveLength(0);
  await f.controller.refresh();
  f.deps.oauth.mockRejectedValueOnce(new Error("denied"));
  await f.prompts[0].reconnect();
  expect(f.errors).toEqual([{ kind: "start", name: "mcp" }]);
  await f.prompts[0].reconnect();
  await f.controller.event("mcpServer/oauthLogin/completed", {
    name: "mcp",
    success: false,
    error: "private",
  });
  expect(f.errors.at(-1)).toEqual({ kind: "completion", name: "mcp" });
  f.controller.stop();
});
it("a late incomplete inventory never clears a newer startup failure", async () => {
  const f = fixture();
  let resolve!: (v: any) => void;
  f.deps.inventory.mockImplementationOnce(
    () => new Promise((r) => (resolve = r)),
  );
  const old = f.controller.refresh();
  await Promise.resolve();
  await f.controller.event("mcpServer/startupStatus/updated", {
    name: "mcp",
    status: "failed",
    failureReason: "reauthenticationRequired",
    threadId: null,
  });
  resolve({ data: [], nextCursor: null });
  await old;
  expect(f.prompts).toHaveLength(1);
  expect(f.prompts[0].close).not.toHaveBeenCalled();
  f.controller.stop();
});
it("native startup ready clears the requirement but leaves the card until its next action", async () => {
  const f = fixture();
  await f.controller.refresh();
  await f.controller.event("mcpServer/startupStatus/updated", {
    name: "mcp",
    status: "ready",
    threadId: null,
  });
  expect(f.prompts[0].close).not.toHaveBeenCalled();
  await f.prompts[0].reconnect();
  expect(f.prompts[0].close).toHaveBeenCalledTimes(1);
  expect(f.deps.oauth).not.toHaveBeenCalled();
  f.controller.stop();
});
it("runtime scope cannot become a partial grant when projected metadata exceeded its budget", async () => {
  const f = fixture(false);
  await f.controller.event("item/completed", {
    threadId: "A",
    item: {
      type: "mcpToolCall",
      server: "mcp",
      nativeMcpAuthChallenge: { scopes: [], truncated: true },
    },
  });
  await f.prompts[0].reconnect();
  expect(f.deps.oauth).not.toHaveBeenCalled();
  expect(f.errors).toEqual([{ kind: "start", name: "mcp" }]);
  f.controller.stop();
});
