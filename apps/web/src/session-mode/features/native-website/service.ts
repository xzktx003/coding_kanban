import {
  nativeWebsiteDisplayData,
  nativeWebsitePreviewUrl,
  type NativeWebsitePreviewData,
} from "@agent-orchestrator/shared";
import { buildUrl } from "@session/hooks/runtime";
import { postJsonWithOptions } from "@session/services/apiAdapt/shared";
import { usePairingStore } from "@session/stores/usePairingStore";
import type { NativeRichPreviewTransport } from "@session/components/codex/presentation/NativeSlackPreview";
// Image payloads must not accumulate in closed link controllers beyond the host's native budget.
const retained = new Map<
  object,
  { bytes: number; evict: () => void; visible: boolean }
>();
let bytes = 0;
function release(owner: object) {
  const previous = retained.get(owner);
  if (previous) {
    bytes -= previous.bytes;
    retained.delete(owner);
  }
}
function retain(
  owner: object,
  data: NativeWebsitePreviewData,
  evict: () => void,
  visible: boolean,
) {
  release(owner);
  const size = JSON.stringify(data).length * 2;
  retained.set(owner, { bytes: size, evict, visible });
  bytes += size;
  while (retained.size > 32 || bytes > 24 * 1024 * 1024) {
    const oldest =
      Array.from(retained.entries()).find(([, entry]) => !entry.visible) ??
      retained.entries().next().value;
    if (!oldest) break;
    release(oldest[0]);
    oldest[1].evict();
  }
}
export function createNativeWebsitePreviewTransport(
  href: string,
): NativeRichPreviewTransport<string> {
  const owner = {},
    url = nativeWebsitePreviewUrl(href);
  if (url) url.hash = "";
  let endpoint = buildUrl("/api/codex/website-preview"),
    epoch = 0,
    visible = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(options?: { reload?: boolean }) => void>();
  const identity = () => `${endpoint}:${epoch}:${url?.href}`;
  const invalidate = () => {
    clearTimeout(timer);
    release(owner);
    epoch++;
    for (const callback of listeners) callback({ reload: false });
  };
  const startGc = () => {
    clearTimeout(timer);
    if (!visible && retained.has(owner))
      timer = setTimeout(invalidate, 300_000);
  };
  return {
    setVisible(value) {
      visible = value;
      const entry = retained.get(owner);
      if (entry) entry.visible = value;
      startGc();
    },
    identity: (target) =>
      url &&
      target === url.href &&
      endpoint === buildUrl("/api/codex/website-preview")
        ? identity()
        : null,
    normalize: nativeWebsiteDisplayData,
    async read(target, signal, check) {
      check();
      if (!url || target !== url.href)
        throw new Error("Website target changed");
      const revision = epoch,
        captured = endpoint;
      const result = nativeWebsiteDisplayData(
        await postJsonWithOptions(
          "/api/codex/website-preview",
          { url: target },
          { signal, suppressToast: true },
        ),
      );
      check();
      if (
        signal.aborted ||
        revision !== epoch ||
        captured !== buildUrl("/api/codex/website-preview")
      )
        throw new Error("Website host changed");
      retain(owner, result, invalidate, visible);
      startGc();
      return result;
    },
    subscribe(callback) {
      listeners.add(callback);
      const stop = usePairingStore.subscribe((state, previous) => {
        const a = state.desktops.find((d) => d.host === state.selectedHost),
          b = previous.desktops.find((d) => d.host === previous.selectedHost);
        if (
          state.selectedHost !== previous.selectedHost ||
          a?.port !== b?.port ||
          a?.token !== b?.token
        ) {
          endpoint = buildUrl("/api/codex/website-preview");
          invalidate();
        }
      });
      return () => {
        stop();
        listeners.delete(callback);
        if (!listeners.size) invalidate();
      };
    },
  };
}
