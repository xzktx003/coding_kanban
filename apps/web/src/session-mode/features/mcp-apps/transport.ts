import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { readWithDeadline } from "@session/services/sessionReadQueue";
import { SessionApiError } from "@session/services/apiAdapt/shared";

/** One mounted view captures its original host and credentials; widgets never receive either. */
export function createMcpAppTransport() {
  const endpoint = buildUrl("/api/codex/mcp/app/"), headers = { "Content-Type": "application/json", ...authHeaders() };
  const stamp = JSON.stringify([endpoint, headers]);
  const current = () => stamp === JSON.stringify([buildUrl("/api/codex/mcp/app/"), { "Content-Type": "application/json", ...authHeaders() }]);
  return { current,
    async request<T>(action: "context" | "read" | "result" | "call" | "revoke", body: unknown, parent?: AbortSignal): Promise<T> {
      if (action !== "revoke" && !current()) throw new Error("应用连接已变化，请重新打开应用");
      return readWithDeadline(async (signal) => {
        const response = await fetch(endpoint + action, { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "error" });
        const length = Number(response.headers.get("content-length"));
        if (Number.isFinite(length) && length > 3_145_728) throw new Error("应用响应超出可显示大小");
        const reader = response.body?.getReader(); if (!reader) throw new Error("应用响应为空");
        const chunks: Uint8Array[] = []; let size = 0;
        try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 3_145_728) { await reader.cancel(); throw new Error("应用响应超出可显示大小"); } chunks.push(next.value); } }
        finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const result = JSON.parse(new TextDecoder().decode(bytes));
        if (!response.ok) throw new SessionApiError(typeof result?.error === "string" ? result.error : typeof result?.message === "string" ? result.message : `应用请求失败（${response.status}）`, response.status);
        if (action !== "revoke" && !current()) throw new Error("应用连接已变化，请重新打开应用");
        return result as T;
      }, 30_000, parent);
    },
  };
}
