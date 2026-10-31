import { createHash, randomUUID } from "node:crypto";
export function createSessionRuntimeProtocol(health: () => Promise<unknown>) {
  const gateway = randomUUID();
  let identity: string | undefined;
  return {
    async read() {
      const value = (await health()) as Record<string, any>;
      const valid =
        value?.status === "ok" &&
        typeof value.instance === "string" &&
        /^[a-zA-Z0-9_-]{1,160}$/.test(value.instance);
      const modern =
        valid &&
        value.runtime === "typescript" &&
        value.codexBackend === "shared-daemon";
      const legacy =
        valid &&
        value.runtime === undefined &&
        value.codexBackend === undefined &&
        value.capabilities?.codexOwnership === true;
      if (!modern && !legacy)
        throw Object.assign(new Error("无法核实会话运行协议，消息尚未发送"), {
          statusCode: 503,
        });
      const backend = legacy ? "legacy-stdio" : "shared-daemon";
      const current = `${backend}:${value.instance}`;
      if (identity !== undefined && identity !== current)
        throw Object.assign(
          new Error("会话运行实例已变化，请核对原队列后重新连接网关"),
          { statusCode: 409 },
        );
      identity = current;
      // Runtime identity only; never an account domain or native atomic guard.
      return {
        backend,
        instance: value.instance as string,
        scopeToken: `legacy:${createHash("sha256").update(`${gateway}:${current}`).digest("hex")}`,
        namespace: `legacy:${value.instance}`,
      };
    },
  };
}
export type SessionRuntimeProtocol = ReturnType<
  typeof createSessionRuntimeProtocol
>;
