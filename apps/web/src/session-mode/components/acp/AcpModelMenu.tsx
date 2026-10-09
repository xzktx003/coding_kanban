import {
  type AcpConfigOption,
  acpSetConfigOption,
  acpSetModel,
} from "@session/services/apiAdapt/acp";
import { useWorkspaceStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { AcpChoiceMenu } from "./AcpChoiceMenu";
import { authenticateAcpSession } from "./authenticateSession";
import { applyAcpSessionSetting } from "./sessionSettings";
import { useSessionActionConfirmation } from "../common/useSessionActionConfirmation";

/** Loose match between an auth method id (e.g. "grok") and a model id/name it likely owns. */
function ownedByMethod(text: string, methodId: string): boolean {
  return text.toLowerCase().includes(methodId.toLowerCase());
}

/**
 * The composer's account/model/effort menu, wired to the live connection:
 * every pick is applied to the running agent straight away, and reverted if
 * the agent rejects it. `AcpChoiceMenu` does the rendering.
 *
 * There is no `signedIn` status from the backend — `authenticate` is
 * fire-and-forget — so "Account" only reflects the last method we asked for
 * and got no error back on, not a live read of the agent's session.
 */
export function AcpModelMenu({ embedded = false }: { embedded?: boolean }) {
  const {
    connectionId,
    sessionId,
    models,
    configOptions,
    reasoningEffort,
    authMethods,
    authenticating,
    authNotice,
    selectedAuthMethod,
    setCurrentModel,
    setReasoningEffort,
    setConfigOptionValue,
  } = useAcpStore();
  const cwd = useWorkspaceStore((s) => s.cwd);
  const { ask, confirmation } = useSessionActionConfirmation();

  if (!connectionId || !sessionId)
    return embedded ? (
      <p className="px-2 py-3 text-xs text-muted-foreground">
        Connecting to agent…
      </p>
    ) : null;

  const changeConfigOption = (
    option: AcpConfigOption,
    value: string | boolean,
  ) => {
    const previous =
      useAcpStore.getState().configOptions.find((o) => o.id === option.id)
        ?.currentValue ?? option.currentValue;
    return applyAcpSessionSetting(
      `config:${option.id}`,
      () => setConfigOptionValue(option.id, value),
      () => setConfigOptionValue(option.id, previous),
      (connection, session) =>
        acpSetConfigOption(connection, session, option.id, value),
    );
  };

  const changeModel = (modelId: string, effort: string | null) => {
    const previousModel = useAcpStore.getState().models?.currentModelId;
    const previousEffort = useAcpStore.getState().reasoningEffort;
    return applyAcpSessionSetting(
      "model",
      () => {
        setCurrentModel(modelId);
        setReasoningEffort(effort);
      },
      () => {
        if (previousModel) setCurrentModel(previousModel);
        setReasoningEffort(previousEffort);
      },
      (connection, session) =>
        acpSetModel(connection, session, modelId, effort),
    );
  };

  const selectModelForMethod = async (methodId: string) => {
    const s = useAcpStore.getState();
    if (!s.connectionId || !s.sessionId) return;

    const modelOption = s.configOptions.find(
      (o) => o.category === "model" || o.category === "model_config",
    );
    if (modelOption?.options?.length) {
      const match =
        modelOption.options.find(
          (o) =>
            ownedByMethod(o.value, methodId) || ownedByMethod(o.name, methodId),
        ) ?? modelOption.options[0];
      if (match.value !== modelOption.currentValue) {
        await changeConfigOption(modelOption, match.value);
      }
      const current = useAcpStore.getState();
      if (
        current.connectionId !== s.connectionId ||
        current.sessionId !== s.sessionId ||
        current.agentId !== s.agentId
      )
        return;
      const effortOption = useAcpStore
        .getState()
        .configOptions.find((o) => o.category === "thought_level");
      if (
        effortOption?.options?.length &&
        effortOption.options[0].value !== effortOption.currentValue
      ) {
        changeConfigOption(effortOption, effortOption.options[0].value);
      }
      return;
    }

    if (s.models?.availableModels.length) {
      const match =
        s.models.availableModels.find(
          (m) =>
            ownedByMethod(m.modelId, methodId) ||
            ownedByMethod(m.name, methodId),
        ) ?? s.models.availableModels[0];
      const efforts = match._meta?.reasoningEfforts ?? [];
      const effort =
        efforts.find((e) => e.default)?.id ?? efforts[0]?.id ?? null;
      changeModel(match.modelId, effort);
    }
  };

  const signIn = async (methodId: string) => {
    if (authenticating) return;
    const original = useAcpStore.getState();
    if (original.sessionTransition || original.sessionTransitionError || !cwd)
      return;
    if (original.running) {
      const accepted = await ask({
        title: "中断任务并切换账号？",
        description:
          "切换账号需要中断当前任务并新建会话以刷新模型。历史记录和草稿会保留。",
        confirmLabel: "中断并切换账号",
      });
      const current = useAcpStore.getState();
      if (
        !accepted ||
        current.connectionId !== original.connectionId ||
        current.sessionId !== original.sessionId ||
        current.agentId !== original.agentId ||
        useWorkspaceStore.getState().cwd !== cwd
      )
        return;
    }
    if (
      await authenticateAcpSession(connectionId, methodId, cwd, {
        allowInterrupt: original.running,
      })
    )
      await selectModelForMethod(methodId);
  };

  return (
    <>
      <AcpChoiceMenu
        embedded={embedded}
        authMethods={authMethods}
        selectedAuthMethod={selectedAuthMethod}
        onSelectAuthMethod={(methodId) => void signIn(methodId)}
        authenticating={authenticating}
        authNotice={authNotice}
        configOptions={configOptions}
        onConfigOptionChange={changeConfigOption}
        models={models}
        reasoningEffort={reasoningEffort}
        onModelChange={changeModel}
      />
      {confirmation}
    </>
  );
}
