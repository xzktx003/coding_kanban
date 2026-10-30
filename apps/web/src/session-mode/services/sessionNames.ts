import { renameThread, threadMetadata } from "./apiAdapt";
import { captureCodexOperationScope, isCodexOperationScopeCurrent } from "./codexOperationScope";
import { recordAppAction } from "../components/codex/composer/appActionHistory";
import { saveSessionName } from "../lib/settings";
import {
  SESSION_NAME_LIMIT,
  type SessionKind,
  useSessionNameStore,
  sessionNameKey,
} from "../stores/useSessionNameStore";
import { useCodexStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { usePinStore } from "../stores/usePinStore";

type NameProof = { name: string; revision: number };
async function writeName(kind: SessionKind, id: string, value: string, expected?: NameProof): Promise<NameProof | undefined> {
  const name = value.trim();
  if (
    !["codex", "cc", "acp"].includes(kind) ||
    !id.trim() ||
    id.length > 256 ||
    /[\x00-\x1f]/.test(id)
  )
    throw new Error("Invalid session");
  if (!name || name.length > SESSION_NAME_LIMIT || /[\x00-\x1f]/.test(name))
    throw new Error(
      `会话名称应为 1–${SESSION_NAME_LIMIT} 个字符，不能包含换行`,
    );
  const key = sessionNameKey(kind, id), scope = captureCodexOperationScope();
  const state = useSessionNameStore.getState();
  if (expected && ((state.editRevisions[key] ?? 0) !== expected.revision || state.names[key] !== expected.name)) throw new Error("会话名称已被其他操作修改，无法撤销或重做");
  if (kind === "codex" && expected) {
    const metadata = await threadMetadata(id);
    if (metadata.thread?.id !== id || metadata.thread?.name !== expected.name || !isCodexOperationScopeCurrent(scope)) throw new Error("官方会话名称或账号已变化，无法撤销或重做");
    if ((useSessionNameStore.getState().editRevisions[key] ?? 0) !== expected.revision) throw new Error("会话名称已变化");
  }
  let intentRevision = 0;
  useSessionNameStore.setState(current => {
    intentRevision = (current.editRevisions[key] ?? 0) + 1;
    return { editRevisions: { ...current.editRevisions, [key]: intentRevision } };
  });
  if (kind === "codex") {
    await renameThread(id, name);
    if (!isCodexOperationScopeCurrent(scope)) return;
    const latest = useSessionNameStore.getState();
    if ((latest.editRevisions[key] ?? 0) !== intentRevision && latest.names[key] !== name) return;
    useCodexStore.setState((s) => ({
      threads: s.threads.map((thread) =>
        thread.id === id ? { ...thread, name } : thread,
      ),
    }));
  } else {
    await saveSessionName(`${kind}:${id}`, name);
  }
  const latest = useSessionNameStore.getState();
  if ((latest.editRevisions[key] ?? 0) !== intentRevision && latest.names[key] !== name) return;
  if (latest.names[key] !== name || (latest.editRevisions[key] ?? 0) === intentRevision) latest.setName(kind, id, name);
  if (kind !== "acp") {
    useAgentCenterStore.setState((s) => ({
      cards: s.cards.map((card) =>
        card.kind === kind && card.id === id
          ? { ...card, preview: name }
          : card,
      ),
    }));
    usePinStore.setState((s) => ({
      pinned: s.pinned.map((pin) =>
        pin.kind === kind && pin.id === id ? { ...pin, title: name } : pin,
      ),
    }));
  }
  return { name, revision: useSessionNameStore.getState().editRevisions[key] ?? 0 };
}

export async function renameSession(kind: SessionKind, id: string, value: string): Promise<void> {
  const key = sessionNameKey(kind, id), scope = captureCodexOperationScope();
  const previous = useSessionNameStore.getState().names[key] ?? (kind === "codex" ? useCodexStore.getState().threads.find(thread => thread.id === id)?.name : undefined);
  let proof = await writeName(kind, id, value);
  if (kind !== "codex" || !previous || !proof || !isCodexOperationScopeCurrent(scope)) return;
  const next = value.trim();
  recordAppAction({
    label: "重命名聊天",
    current: () => isCodexOperationScopeCurrent(scope),
    undo: async () => { const result = await writeName(kind, id, previous, proof); if (!result) throw new Error("会话名称已变化，撤销结果待核对"); proof = result; },
    redo: async () => { const result = await writeName(kind, id, next, proof); if (!result) throw new Error("会话名称已变化，重做结果待核对"); proof = result; },
  });
}
