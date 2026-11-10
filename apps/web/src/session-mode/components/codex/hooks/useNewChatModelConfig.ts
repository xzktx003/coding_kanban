import { useCodexStore } from "../stores/useCodexStore";
import { useAgentInteractionVisible } from "@session/session-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import {
  readNewChatModelConfig,
  type NewChatModelConfig,
} from "@session/services/newChatModelConfig";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "@session/services/codexOperationScope";

/** A single visible selector owns this bounded read; no background polling. */
export function useNewChatModelConfig(
  enabled: boolean,
  open: boolean,
  willOpenOnMount = false,
) {
  const cwd = useWorkspaceStore((s) => s.cwd);
  const visible = useAgentInteractionVisible();
  const namespace = useCodexStore(s => s.accountNamespace);
  const hasAccount = useCodexStore(s => s.hasAccount);
  const [state, setState] = useState<{
    cwd: string | null;
    value?: NewChatModelConfig;
    error?: string;
    loading: boolean;
  }>({ cwd: null, loading: false });
  const serial = useRef(0);
  const wasOpen = useRef(false);
  const skipInitialOpenRefresh = useRef(willOpenOnMount);
  const refresh = useCallback(async () => {
    if (!enabled || !visible || !cwd) return;
    const id = ++serial.current;
    const scope = captureCodexOperationScope();
    setState({ cwd, loading: true });
    try {
      const value = await readNewChatModelConfig(cwd);
      if (id === serial.current && isCodexOperationScopeCurrent(scope))
        setState({ cwd, value, loading: false });
    } catch (error) {
      if (id === serial.current && isCodexOperationScopeCurrent(scope))
        setState({
          cwd,
          error: error instanceof Error ? error.message : "无法读取模型配置",
          loading: false,
        });
    }
  }, [enabled, visible, cwd, namespace, hasAccount]);
  useEffect(() => {
    // The selector can mount with its menu already open. Seed the open edge
    // before the separate open effect runs so that mount performs one read.
    wasOpen.current = open;
    if (open) skipInitialOpenRefresh.current = false;
    void refresh();
    return () => {
      serial.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (open && !wasOpen.current) {
      if (!skipInitialOpenRefresh.current) void refresh();
      skipInitialOpenRefresh.current = false;
    }
    wasOpen.current = open;
  }, [open, refresh]);
  useEffect(() => {
    const changed = () => {
      serial.current++;
      setState({ cwd: null, loading: false });
      void refresh();
    };
    window.addEventListener("session-runtime-restarted", changed);
    return () =>
      window.removeEventListener("session-runtime-restarted", changed);
  }, [refresh]);
  return { ...(state.cwd === cwd ? state : { cwd, value: undefined, error: undefined, loading: false }), refresh };
}
