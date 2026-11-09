import { viteChatgptDocumentContinuity } from "../../scripts/vite-chatgpt-document-continuity.mjs";

/** Apply only to a new candidate process; never replace an existing page. */
export function enableChatgptDocumentGuard(base) {
  if (!base || !Array.isArray(base.plugins)) {
    throw new Error("ChatGPT candidate continuity configuration is missing");
  }

  let found = 0;
  const replace = (entry) => {
    if (Array.isArray(entry)) return entry.map(replace);
    // A deferred plugin could conceal another continuity handler. Reject it
    // rather than starting with uncertain ordering or duplicate state routes.
    if (entry && typeof entry.then === "function") {
      throw new Error("ChatGPT candidate continuity configuration is deferred");
    }
    if (entry?.name === "workbench-chatgpt-document-continuity") {
      throw new Error("ChatGPT candidate continuity guard is already installed");
    }
    if (entry?.name !== "workbench-document-continuity") return entry;
    if (++found !== 1) {
      throw new Error("ChatGPT candidate continuity configuration is ambiguous");
    }
    return viteChatgptDocumentContinuity();
  };

  const plugins = base.plugins.map(replace);
  if (found !== 1) {
    throw new Error("ChatGPT candidate continuity configuration is missing");
  }
  return { ...base, plugins };
}
