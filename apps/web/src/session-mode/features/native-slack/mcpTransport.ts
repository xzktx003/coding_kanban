import type { NativeSlackData } from "@agent-orchestrator/shared";
import { buildUrl } from "@session/hooks/runtime";
import { openEventStream } from "@session/lib/eventStream";
import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
import { usePairingStore } from "@session/stores/usePairingStore";
import type { NativeRichPreviewTransport } from "@session/components/codex/presentation/NativeSlackPreview";
type Context = { identity: string; token: string };
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const contextValue = (value: unknown): Context | null => {
  const c = record(value) ? value.context : null;
  return record(c) &&
    typeof c.identity === "string" &&
    /^[a-f0-9]{64}$/u.test(c.identity) &&
    typeof c.token === "string" &&
    /^[a-f0-9]{64}$/u.test(c.token)
    ? { identity: c.identity, token: c.token }
    : null;
};
/** One link's identity state; the backend coalesces shared account/target reads. */
export function createNativeMcpPreviewTransport<T>(
  href: string,
  definition: {
    target: (href: string) => T | null;
    normalize: (value: unknown) => NativeSlackData;
    path: string;
    label: string;
  },
): NativeRichPreviewTransport<T> {
  const targetKey = JSON.stringify(definition.target(href));
  let epoch = 0,
    context: Context | null = null,
    until = 0,
    endpoint = "";
  const listeners = new Set<(options?: { reload?: boolean }) => void>();
  const background = new Set<AbortController>();
  let directoryQueued = false;
  const matches = (target: T) =>
    JSON.stringify(target) === targetKey &&
    endpoint === buildUrl(`${definition.path}/context`);
  const invalidate = (reload = true) => {
    epoch++;
    context = null;
    until = 0;
    directoryQueued = false;
    for (const abort of background) abort.abort();
    background.clear();
    for (const notify of listeners) notify({ reload });
  };
  const prepare = async (
    target: T,
    signal: AbortSignal,
    before: () => void,
    force = false,
  ) => {
    before();
    if (!force && matches(target) && until > Date.now())
      return context?.identity ?? null;
    const captured = epoch,
      origin = buildUrl(`${definition.path}/context`);
    let next: Context | null;
    try {
      next = contextValue(
        await postJsonWithOptions(
          `${definition.path}/context`,
          { href },
          { signal, suppressToast: true },
        ),
      );
    } catch (error) {
      if (signal.aborted) throw error;
      next = null;
    }
    before();
    if (
      signal.aborted ||
      epoch !== captured ||
      origin !== buildUrl(`${definition.path}/context`)
    )
      throw new Error("MCP preview host changed");
    context = next;
    endpoint = origin;
    until = Date.now() + 60_000;
    return context?.identity ?? null;
  };
  const refreshDirectory = () => {
    const target = definition.target(href);
    if (!target || !until || !matches(target)) return;
    if (background.size) {
      directoryQueued = true;
      return;
    }
    const previous = context?.identity ?? null,
      abort = new AbortController();
    background.add(abort);
    void prepare(
      target,
      abort.signal,
      () => {
        if (abort.signal.aborted) throw new Error("Preview inactive");
      },
      true,
    )
      .then((next) => {
        if (next !== previous) for (const notify of listeners) notify();
      })
      .catch(() => {})
      .finally(() => {
        background.delete(abort);
        if (directoryQueued) {
          directoryQueued = false;
          refreshDirectory();
        }
      });
  };
  return {
    identity: (target) =>
      matches(target) ? (context?.identity ?? null) : null,
    prepare,
    normalize: definition.normalize,
    async read(target, signal, beforeRequest) {
      const captured = context,
        revision = epoch;
      beforeRequest();
      if (!captured || !matches(target))
        throw new Error("MCP preview context missing");
      const result = await postJsonWithOptions<unknown>(
        `${definition.path}/read`,
        { href, contextToken: captured.token },
        { signal, suppressToast: true },
      );
      beforeRequest();
      if (
        signal.aborted ||
        revision !== epoch ||
        context?.identity !== captured.identity ||
        !matches(target) ||
        !record(result) ||
        result.identity !== captured.identity
      )
        throw new Error("MCP preview connection changed");
      return definition.normalize(result.data);
    },
    subscribe(notify) {
      listeners.add(notify);
      const stop = openEventStream({
        agents: ["codex"],
        label: definition.label,
        onResync: () => invalidate(false),
        onEvent: (event) => {
          if (event.event === "codex:disconnected") {
            invalidate(false);
            return;
          }
          const payload = record(event.payload) ? event.payload : {};
          if (
            ["account/updated", "account/login/completed"].includes(
              String(payload.method),
            )
          )
            invalidate();
          if (
            [
              "mcpServer/oauthLogin/completed",
              "mcpServer/startupStatus/updated",
              "app/list/updated",
            ].includes(String(payload.method))
          )
            refreshDirectory();
        },
      });
      const restart = () => invalidate(false);
      window.addEventListener("session-runtime-restarted", restart);
      const stopPairing = usePairingStore.subscribe((state, previous) => {
        const a = state.desktops.find((d) => d.host === state.selectedHost),
          b = previous.desktops.find((d) => d.host === previous.selectedHost);
        if (
          state.selectedHost !== previous.selectedHost ||
          a?.host !== b?.host ||
          a?.port !== b?.port ||
          a?.token !== b?.token
        )
          invalidate();
      });
      return () => {
        stop();
        stopPairing();
        listeners.delete(notify);
        window.removeEventListener("session-runtime-restarted", restart);
        if (!listeners.size) invalidate();
      };
    },
  };
}
