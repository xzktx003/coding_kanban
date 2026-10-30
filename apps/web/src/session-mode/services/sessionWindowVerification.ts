import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { getJsonWithOptions, SessionApiError } from "./apiAdapt/shared";
import { threadMetadata } from "./apiAdapt/codex";
import { ccReadSessionSnapshot } from "./apiAdapt/cc";
import { readWithDeadline } from "./sessionReadQueue";
import {
  validateWindowTarget,
  type WindowAuthority,
  type WindowTarget,
} from "./sessionWindowRecords";

export const sessionWindowEndpoint = () => buildUrl("/health");
export const sessionWindowConnection = () =>
  JSON.stringify([sessionWindowEndpoint(), authHeaders()]);
/** Fixed, bounded read-only proofs. This never resumes or starts an Agent. */
export async function verifySessionWindowTarget(
  target: WindowTarget,
  signal?: AbortSignal,
  options?: { recheckContext?: boolean },
): Promise<WindowAuthority> {
  validateWindowTarget(target);
  const connection = sessionWindowConnection();
  return readWithDeadline(
    async (bounded) => {
      const health = await getJsonWithOptions<{
        status: string;
        instance: string;
      }>("/health", { signal: bounded, suppressToast: true });
      if (
        health.status !== "ok" ||
        typeof health.instance !== "string" ||
        !health.instance ||
        health.instance.length > 512
      )
        throw new Error("无法核实新窗口的运行服务来源。");
      let codexNamespace: string | undefined,
        daemonIdentity: string | undefined;
      if (target.kind === "codex") {
        const readContext = () =>
          getJsonWithOptions<{
            namespace: string;
            scopeToken?: string;
            daemonIdentity?: string;
          }>("/lifecycle/context", {
            signal: bounded,
            suppressToast: true,
          });
        const [context, metadata] = options?.recheckContext
          ? await (async () => {
              const before = await readContext();
              const metadata = await threadMetadata(target.id, {
                signal: bounded,
                suppressToast: true,
              });
              return [before, metadata] as const;
            })()
          : await Promise.all([
              readContext(),
              threadMetadata(target.id, {
                signal: bounded,
                suppressToast: true,
              }),
            ]);
        if (
          typeof context.namespace !== "string" ||
          !context.namespace ||
          context.namespace.length > 512 ||
          metadata.thread?.id !== target.id ||
          metadata.thread.cwd !== target.cwd
        )
          throw new Error("新窗口返回的会话或项目与原目标不一致。");
        codexNamespace = context.namespace;
        if (
          typeof context.daemonIdentity === "string" &&
          /^[a-f0-9]{64}$/.test(context.daemonIdentity)
        )
          daemonIdentity = context.daemonIdentity;
        if (options?.recheckContext) {
          const [after, afterHealth] = await Promise.all([
            readContext(),
            getJsonWithOptions<{ status: string; instance: string }>(
              "/health",
              { signal: bounded, suppressToast: true },
            ),
          ]);
          if (
            typeof context.scopeToken !== "string" ||
            !context.scopeToken ||
            context.scopeToken.length > 512 ||
            after.scopeToken !== context.scopeToken ||
            after.namespace !== context.namespace ||
            !daemonIdentity ||
            after.daemonIdentity !== daemonIdentity ||
            afterHealth.status !== "ok" ||
            afterHealth.instance !== health.instance
          )
            throw new Error(
              "运行服务或账号在只读核对期间已改变，保留原窗口与草稿。",
            );
        }
      } else {
        try {
          const snapshot = await ccReadSessionSnapshot(target.id, target.cwd!, {
            signal: bounded,
            suppressToast: true,
          });
          if (
            snapshot.sessionId !== target.id ||
            snapshot.cwd !== target.cwd ||
            snapshot.runtimeInstance !== health.instance
          )
            throw new Error("新窗口的 Claude 会话归属不一致。");
        } catch (error) {
          if (!(error instanceof SessionApiError) || error.status !== 404)
            throw error;
          // An idle historical session may have no live SDK owner. Verify its
          // exact native metadata instead; never recover it with resume.
          let offset = 0,
            bytes = 0,
            found = false;
          for (;;) {
            const query = new URLSearchParams({
              directory: target.cwd!,
              limit: "100",
              offset: String(offset),
              includeWorktrees: "false",
            });
            const page = await getJsonWithOptions<{
              sessions: Array<{
                session_id?: string;
                sessionId?: string;
                cwd?: string;
              }>;
              total: number;
            }>("/api/cc/sessions?" + query, {
              signal: bounded,
              suppressToast: true,
            });
            bytes += new TextEncoder().encode(JSON.stringify(page)).byteLength;
            if (
              !Array.isArray(page.sessions) ||
              !Number.isSafeInteger(page.total) ||
              page.total < 0 ||
              bytes > 1024 * 1024
            )
              throw new Error("Claude 会话来源元数据无法在读取预算内核实。");
            found = page.sessions.some(
              (row) =>
                (row.session_id ?? row.sessionId) === target.id &&
                row.cwd === target.cwd,
            );
            if (
              found ||
              !page.sessions.length ||
              offset + page.sessions.length >= page.total
            )
              break;
            offset += page.sessions.length;
          }
          if (!found)
            throw new Error("Claude 原会话来源尚未确认，未打开替代会话。");
        }
      }
      if (bounded.aborted || connection !== sessionWindowConnection())
        throw new Error("连接或配对在核对期间已改变，未选择任何输入目标。");
      return {
        runtimeInstance: health.instance,
        ...(codexNamespace ? { codexNamespace } : {}),
        ...(daemonIdentity ? { daemonIdentity } : {}),
      };
    },
    10_000,
    signal,
  );
}
