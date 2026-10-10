/** Runs inside the existing same-origin editor frame, without replacing its URL. */
function relay() {
  const key = "__codingKanbanCodexHostRelay";
  const win = window as typeof window & { [key]?: boolean };
  if (win[key] || window.parent === window) return;
  win[key] = true;
  const channel = "coding-kanban.codex-host",
    version = 1,
    origin = location.origin;
  const params = new URL(location.href).searchParams;
  const folder = params.get("kanbanCwd") ?? params.get("folder");
  let binding: any = null,
    polling = false;
  const send = (
    type: string,
    payload?: unknown,
    requestId?: string,
    error?: string,
  ) => {
    if (binding)
      window.parent.postMessage(
        {
          channel,
          version,
          nonce: binding.nonce,
          owner: binding.owner,
          type,
          payload,
          requestId,
          error,
        },
        origin,
      );
  };
  const request = async (path: string, body: unknown) => {
    const response = await fetch("/api/session/codex-host/" + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const value = await response.json();
    if (!response.ok)
      throw new Error(value.message ?? value.error ?? "编辑器宿主连接失败");
    return value;
  };
  window.addEventListener("message", async (event) => {
    const message = event.data;
    if (
      event.source !== window.parent ||
      event.origin !== origin ||
      !message ||
      message.channel !== channel ||
      message.version !== version ||
      typeof message.nonce !== "string" ||
      !message.owner ||
      message.owner.cwd !== folder
    )
      return;
    if (message.type === "init") {
      if (binding && binding.nonce !== message.nonce)
        void request("dispose", binding).catch(() => {});
      binding = { nonce: message.nonce, owner: message.owner };
      try {
        send("ready", await request("state", binding));
      } catch (error) {
        send("status", undefined, undefined, String(error));
      }
      return;
    }
    if (
      !binding ||
      binding.nonce !== message.nonce ||
      JSON.stringify(binding.owner) !== JSON.stringify(message.owner)
    )
      return;
    if (message.type === "dispose") {
      void request("dispose", binding).catch(() => {});
      binding = null;
      return;
    }
    if (message.type === "command" && typeof message.requestId === "string") {
      const captured = binding;
      try {
        const result = await request("command", {
          ...captured,
          command: message.payload,
        });
        if (binding === captured) send("result", result, message.requestId);
      } catch (error) {
        if (binding === captured)
          send("result", undefined, message.requestId, String(error));
      }
    }
  });
  window.setInterval(async () => {
    if (!binding || polling) return;
    const captured = binding;
    polling = true;
    try {
      const state = await request("state", captured);
      if (binding !== captured) return;
      send("status", state.status);
      for (const context of state.events ?? []) send("context", context);
    } catch (error) {
      if (binding === captured)
        send("status", undefined, undefined, String(error));
    } finally {
      polling = false;
    }
  }, 1500);
}
// tsx's development transform preserves function names with __name wrappers.
// Keep that helper in this isolated script scope as well as the emitted build.
export const codexHostRelayScript = `(()=>{const __name=(fn)=>fn;(${relay.toString()})();})();`;
