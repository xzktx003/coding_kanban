import { useEffect, useState } from "react";
import { authHeaders, buildUrl } from "@session/hooks/runtime";
import { usePairingStore } from "@session/stores/usePairingStore";
const capabilities = new Map<
  string,
  { expires: number; value: Promise<boolean> }
>();
const stopPairing = usePairingStore.subscribe((state, previous) => {
  const a = state.desktops.find((d) => d.host === state.selectedHost),
    b = previous.desktops.find((d) => d.host === previous.selectedHost);
  if (
    state.selectedHost !== previous.selectedHost ||
    a?.port !== b?.port ||
    a?.token !== b?.token
  )
    capabilities.clear();
});
import.meta.hot?.dispose(() => {
  stopPairing();
  capabilities.clear();
});
function available(endpoint: string): Promise<boolean> {
  const existing = capabilities.get(endpoint);
  if (existing && existing.expires > Date.now()) return existing.value;
  const value = fetch(endpoint, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(8000),
  })
    .then(
      async (response) =>
        response.ok && (await response.json()).supported === true,
    )
    .catch(() => false);
  if (capabilities.size >= 32)
    capabilities.delete(capabilities.keys().next().value!);
  capabilities.set(endpoint, { expires: Date.now() + 30_000, value });
  return value;
}
/** Native kti tests host capability; an old gateway or unknown host retains URL tooltips. */
export function useNativeWebsiteCapability(active: boolean): boolean {
  const [state, setState] = useState<{
    endpoint: string;
    host: string;
    available: boolean;
  } | null>(null);
  const host = usePairingStore((s) => {
    const desktop = s.desktops.find((d) => d.host === s.selectedHost);
    return `${s.selectedHost}:${desktop?.port}:${desktop?.token ?? ""}`;
  });
  const endpoint = buildUrl("/api/codex/website-preview/capabilities");
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const read = () => {
      setState(null);
      void available(endpoint).then((value) => {
        if (alive) setState({ endpoint, host, available: value });
      });
    };
    const reset = () => {
      capabilities.delete(endpoint);
      read();
    };
    read();
    window.addEventListener("session-runtime-restarted", reset);
    return () => {
      alive = false;
      window.removeEventListener("session-runtime-restarted", reset);
    };
  }, [active, endpoint, host]);
  return (
    active &&
    state?.endpoint === endpoint &&
    state.host === host &&
    state.available
  );
}
