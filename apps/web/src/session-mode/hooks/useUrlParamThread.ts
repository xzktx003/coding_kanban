import { useEffect } from "react";
import { navigateToAgentSession } from "@session/lib/agentNav";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { readThreadLink } from "@session/features/thread-workflows/model";
import { openThreadLink } from "@session/features/thread-workflows/threadLinkService";
import { useThreadLinkStore } from "@session/features/thread-workflows/threadLinkStore";
import { useSessionTabActions } from "./useSessionTabs";
import { toast } from "sonner";

let processed = false;

// Reads ?agent=codex&thread=<id>&cwd=<path> or ?agent=cc&session=<id>&cwd=<path>
// from the page URL on first mount and navigates to that agent session.
// Used by external launchers (e.g. rejoin) to deep-link into a specific
// session in web mode.
export function useUrlParamThread(enabled: boolean): void {
  const { selectTab } = useSessionTabActions();
  useEffect(() => {
    if (!enabled || processed) return;
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    if (params.has("thread") && !params.has("agent")) {
      processed = true;
      const source = readThreadLink(window.location.href);
      if (!source) {
        useThreadLinkStore.setState({
          loading: false,
          error: "会话链接无效，未切换会话。",
          target: null,
        });
        toast.error("会话链接无效，未切换会话。");
        return;
      }
      void openThreadLink(source, selectTab).then(
        (opened) => {
          if (!opened && useThreadLinkStore.getState().error)
            toast.info(useThreadLinkStore.getState().error);
        },
        (error) =>
          toast.error(error instanceof Error ? error.message : String(error)),
      );
      return;
    }
    const agent = params.get("agent");
    const cwd = params.get("cwd");
    const threadId = params.get("thread");
    const sessionId = params.get("session");
    const projectsToAdd = params.getAll("addProject").filter(Boolean);
    const hasAgentNav =
      !!agent && !!cwd && (agent === "codex" || agent === "cc");
    if (!hasAgentNav && projectsToAdd.length === 0) return;

    processed = true;

    const cleanUrl =
      window.location.origin + window.location.pathname + window.location.hash;
    window.history.replaceState({}, "", cleanUrl);

    const { addProject } = useWorkspaceStore.getState();
    for (const p of projectsToAdd) addProject(p);

    if (!hasAgentNav) return;

    navigateToAgentSession({ agent, cwd, threadId, sessionId });
  }, [enabled, selectTab]);
}
