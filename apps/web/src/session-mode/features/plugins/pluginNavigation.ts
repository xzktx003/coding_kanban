import type { PluginSummary } from "@session/bindings/v2/PluginSummary";
import { activeDraftOwner } from "@session/stores/useInputStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { selectBuiltinInputTarget } from "@session/services/builtinInputNavigation";
import { appendDraft } from "@session/stores/useSessionDraftStore";
import { pluginInputDrafts, pluginInputMention } from "./pluginInputs";
/** Try now is an explicit navigation; commit identity only after the leave guard. */
export function tryPluginInComposer(plugin: PluginSummary) {
  const mention = pluginInputMention(plugin);
  if (!mention) return;
  const capture = () => ({
    owner: activeDraftOwner(),
    cwd: useWorkspaceStore.getState().cwd,
    card: useAgentCenterStore.getState().currentAgentCardId,
    kind: useAgentCenterStore.getState().currentAgentCardKind,
    codex: useCodexStore.getState().currentThreadId,
  });
  const source = capture();
  useLayoutStore.getState().setView("agent", () => {
    const now = capture();
    if (
      Object.keys(source).some(
        (key) =>
          source[key as keyof typeof source] !== now[key as keyof typeof now],
      )
    )
      return;
    selectBuiltinInputTarget("codex");
    const owner = activeDraftOwner();
    pluginInputDrafts.add(owner, mention);
    appendDraft(owner, `@${mention.name} `);
  });
}
