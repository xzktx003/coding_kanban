import { useCallback, useEffect, useRef } from "react";
import { useGitWatch } from "@session/hooks/useGitWatch";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useGitStatsStore } from "@session/stores/useGitStatsStore";

/** The workspace change count belongs to the workbench, even before the tool
 * panel is first opened. Optional panel loading must not disable this observer. */
export function useWorkspaceGitStatus() {
  const cwd = useWorkspaceStore(state => state.cwd);
  const refreshStats = useGitStatsStore(state => state.refreshStats);
  const current = useRef({ cwd, refreshStats });
  current.current = { cwd, refreshStats };
  useEffect(() => { if (cwd) void refreshStats(cwd, false); }, [cwd, refreshStats]);
  const silentRefresh = useCallback(() => {
    const { cwd, refreshStats } = current.current;
    if (cwd) void refreshStats(cwd, true);
  }, []);
  useGitWatch(cwd, silentRefresh, Boolean(cwd));
}
