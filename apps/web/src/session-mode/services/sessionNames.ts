import { renameThread } from "./apiAdapt";
import { saveSessionName } from "../lib/settings";
import {
  SESSION_NAME_LIMIT,
  type SessionKind,
  useSessionNameStore,
} from "../stores/useSessionNameStore";
import { useCodexStore } from "../components/codex/stores";
import { useAgentCenterStore } from "../stores/useAgentCenterStore";
import { usePinStore } from "../stores/usePinStore";

export async function renameSession(
  kind: SessionKind,
  id: string,
  value: string,
): Promise<void> {
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
  if (kind === "codex") {
    await renameThread(id, name);
    useCodexStore.setState((s) => ({
      threads: s.threads.map((thread) =>
        thread.id === id ? { ...thread, name } : thread,
      ),
    }));
  } else {
    await saveSessionName(`${kind}:${id}`, name);
  }
  useSessionNameStore.getState().setName(kind, id, name);
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
}
