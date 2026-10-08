import { useLayoutStore, type viewType } from "../stores/useLayoutStore";
import { requestSessionNavigation, useSessionNavigationGuard } from "./sessionNavigationGuard";

export const secondaryPages = [
  { view: "automations", label: "定时任务" },
  { view: "plugins", label: "工具与技能" },
  { view: "insights", label: "用量" },
  { view: "settings", label: "设置" },
] as const;
export function isSecondaryPage(view: viewType) {
  return secondaryPages.some((page) => page.view === view);
}
const views: viewType[] = ["agent", "automations", "plugins", "insights", "settings", "agents-md", "bot", "learn", "usage"];
const indexKey = "kanbanSessionPageIndex";
function readView(fallback: viewType): viewType {
  const value = new URLSearchParams(location.search).get("view");
  return value === null ? fallback : views.includes(value as viewType) ? value as viewType : "agent";
}
function pageUrl(view: viewType) {
  const url = new URL(location.href);
  url.searchParams.set("view", view);
  return url.pathname + url.search + url.hash;
}

/** One history entry per page change; UI and popstate share the same leave guard. */
export function startSessionPageHistory() {
  let index = Number.isSafeInteger(history.state?.[indexKey]) ? history.state[indexKey] as number : 0;
  let applyingHistory = false;
  let restoring = false;
  let lastFocus: HTMLElement | null = null;
  let frame = 0;
  useLayoutStore.setState({ view: readView(useLayoutStore.getState().view) });
  history.replaceState({ ...history.state, [indexKey]: index }, "", pageUrl(useLayoutStore.getState().view));
  const rememberFocus = (event: FocusEvent) => {
    const target = event.target;
    if (useLayoutStore.getState().view === "agent" && target instanceof HTMLElement &&
        target.closest(".session-mode") && !target.closest(".session-top-nav, [hidden], [inert]")) lastFocus = target;
  };
  document.addEventListener("focusin", rememberFocus);
  const unsubscribe = useLayoutStore.subscribe((state, previous) => {
    if (state.view === previous.view) return;
    const root = document.querySelector<HTMLElement>(".session-mode");
    if (root?.hidden) return;
    if (previous.view === "agent" && document.activeElement instanceof HTMLElement &&
        root?.contains(document.activeElement) && !document.activeElement.closest(".session-top-nav")) {
      lastFocus = document.activeElement;
    }
    if (!applyingHistory) {
      history.pushState({ ...history.state, [indexKey]: ++index }, "", pageUrl(state.view));
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (root?.hidden) return;
      const fallback = root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? root?.querySelector<HTMLElement>('.session-global-projects');
      // Coarse-pointer devices should not reopen the software keyboard on return.
      const saved = lastFocus?.isConnected && !lastFocus.closest("[hidden], [inert]") &&
        !(window.matchMedia("(pointer: coarse)").matches && lastFocus.matches("input, textarea, [contenteditable]")) ? lastFocus : null;
      const target = state.view === "agent" ? saved ?? fallback : root?.querySelector<HTMLElement>("[data-session-page-heading]");
      target?.focus({ preventScroll: true });
    });
  });
  const pop = () => {
    if (restoring) { restoring = false; return; }
    const targetIndex = Number.isSafeInteger(history.state?.[indexKey]) ? history.state[indexKey] as number : index;
    const view = readView("agent");
    requestSessionNavigation(() => {
      index = targetIndex;
      applyingHistory = true;
      useLayoutStore.setState({ view });
      applyingHistory = false;
    }, () => {
      const delta = index - targetIndex;
      if (delta) { restoring = true; history.go(delta); }
      else history.replaceState({ ...history.state, [indexKey]: index }, "", pageUrl(useLayoutStore.getState().view));
    });
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    const { dirty, saving } = useSessionNavigationGuard.getState();
    if (dirty || saving) { event.preventDefault(); event.returnValue = ""; }
  };
  window.addEventListener("popstate", pop);
  window.addEventListener("beforeunload", beforeUnload);
  return () => {
    unsubscribe();
    document.removeEventListener("focusin", rememberFocus);
    cancelAnimationFrame(frame);
    window.removeEventListener("popstate", pop);
    window.removeEventListener("beforeunload", beforeUnload);
  };
}
