import { viteDocumentContinuity } from "./vite-document-continuity.mjs";

/**
 * A React refresh may remount an iframe even when Vite sends an ordinary
 * "update" rather than a full reload. Without pre-executing the changed
 * module, the client cannot safely know whether that refresh will remount.
 * A protected document therefore defers all JavaScript updates and pruning;
 * standalone stylesheet updates can still be applied before a deferral.
 */
export function shouldDeferWorkbenchHotMessage(payload) {
  if (payload?.type === "prune" || payload?.type === "full-reload") return true;
  if (payload?.type !== "update") return false;
  return (
    !Array.isArray(payload.updates) ||
    payload.updates.length === 0 ||
    payload.updates.some((update) => update?.type !== "css-update")
  );
}

/**
 * Opt-in replacement for viteDocumentContinuity(), not an additional plugin.
 * Do not attach this to an already-running dev server. New documents served by
 * an explicitly configured dev instance get the guard; existing documents do
 * not acquire it retroactively.
 */
export function viteChatgptDocumentContinuity() {
  const continuity = viteDocumentContinuity();
  return {
    ...continuity,
    name: "workbench-chatgpt-document-continuity",
    transform(source, id) {
      const transformed = continuity.transform(source, id);
      if (!transformed) return;
      const marker = "await handleMessage(payload);";
      if (transformed.code.split(marker).length !== 2) {
        throw new Error("Vite ChatGPT document guard contract changed");
      }
      const guarded = `if ((${shouldDeferWorkbenchHotMessage.toString()})(payload)) {
      if (!workbenchUpdatePending) requestWorkbenchReload();
      return;
    }
    ${marker}`;
      return {
        ...transformed,
        code: transformed.code.replace(marker, guarded),
      };
    },
  };
}
