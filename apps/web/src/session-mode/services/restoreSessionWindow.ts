import { sessionWindowId } from "./sessionWindowContext";
import {
  parseSessionWindowRecord,
  SESSION_WINDOW_ACCEPTED,
  SESSION_WINDOW_INTENTS,
  type SessionWindowRecord,
  type WindowTarget,
} from "./sessionWindowRecords";
import {
  sessionWindowEndpoint,
  verifySessionWindowTarget,
} from "./sessionWindowVerification";
import {
  agentCardKey,
  selectedAgentCard,
  useAgentCenterStore,
} from "@session/stores/useAgentCenterStore";
import { useAgentSettingsStore } from "@session/stores/useAgentSettingsStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useSessionSplitStore } from "@session/stores/useSessionSplitStore";
import { useLayoutStore } from "@session/stores/useLayoutStore";
import { useAcpStore } from "@session/stores/useAcpStore";
import { selectCodexInputTarget } from "@session/components/codex/stores/codexInputTarget";
import { useCCStore } from "@session/stores/cc/ccStore";

function waitForSource(
  id: string,
  signal: AbortSignal,
): Promise<SessionWindowRecord> {
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener("storage", check);
      signal.removeEventListener("abort", aborted);
    };
    const failed = (error: unknown) => {
      stop();
      reject(error);
    };
    const aborted = () => failed(new Error("新窗口来源核对已取消。"));
    const check = () => {
      try {
        const value = parseSessionWindowRecord(
          localStorage.getItem(SESSION_WINDOW_INTENTS + id),
          id,
        );
        if (!value || Date.now() - value.createdAt > 120_000)
          throw new Error("新窗口启动意图缺失或已过期，请从原会话重新打开。");
        if (value.status === "failed")
          throw new Error("原会话的连接或账号来源无法核实，请从原页面重试。");
        if (value.status === "ready") {
          stop();
          resolve(value);
        }
      } catch (error) {
        failed(error);
      }
    };
    const timer = setTimeout(
      () => failed(new Error("新窗口来源核对超时，请保留原页面并重试。")),
      12_000,
    );
    window.addEventListener("storage", check);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    else check();
  });
}

/** Restore the page's own operating scene only after fixed read-only source
 * checks; shared interest membership is never rewritten to a one-item list. */
export async function restoreSessionWindow(signal: AbortSignal) {
  const id = sessionWindowId();
  if (!id) throw new Error("新窗口链接无效，未选择任何会话。");
  const ownKey = SESSION_WINDOW_ACCEPTED + id;
  const own = parseSessionWindowRecord(sessionStorage.getItem(ownKey), id);
  const record = own ?? (await waitForSource(id, signal));
  if (record.status !== "ready" || record.endpoint !== sessionWindowEndpoint())
    throw new Error("新窗口的连接或配对来源已改变，未选择任何会话。");
  const selected = own
    ? selectedAgentCard(useAgentCenterStore.getState())
    : undefined;
  const target: WindowTarget = selected
    ? {
        kind: selected.kind,
        id: selected.id,
        cwd: selected.worktreePath || selected.cwd,
      }
    : record.target;
  let authority = await verifySessionWindowTarget(target, signal);
  let verifiedRuntimeRefresh = false;
  if (authority.runtimeInstance !== record.authority?.runtimeInstance) {
    // Replacing the board's gateway/runtime does not replace a shared official
    // Codex daemon. An existing page may rebind only with its original native
    // namespace and a fresh context -> exact metadata -> context proof.
    if (
      !own ||
      target.kind !== "codex" ||
      !record.authority?.codexNamespace ||
      !record.authority.daemonIdentity ||
      authority.daemonIdentity !== record.authority.daemonIdentity ||
      authority.codexNamespace !== record.authority.codexNamespace
    )
      throw new Error("新窗口的运行服务或原生账号范围已改变，未选择替代会话。");
    const confirmed = await verifySessionWindowTarget(target, signal, {
      recheckContext: true,
    });
    if (
      confirmed.runtimeInstance !== authority.runtimeInstance ||
      confirmed.daemonIdentity !== record.authority.daemonIdentity ||
      confirmed.codexNamespace !== record.authority.codexNamespace
    )
      throw new Error("运行服务或账号在只读核对期间已改变，保留原窗口与草稿。");
    authority = confirmed;
    verifiedRuntimeRefresh = true;
  }
  if (
    signal.aborted ||
    sessionWindowId() !== id ||
    record.endpoint !== sessionWindowEndpoint() ||
    (!verifiedRuntimeRefresh &&
      authority.runtimeInstance !== record.authority?.runtimeInstance) ||
    (target.kind === "codex" &&
      record.authority.codexNamespace !== undefined &&
      authority.codexNamespace !== record.authority.codexNamespace) ||
    (target.kind === "codex" &&
      record.authority?.daemonIdentity !== undefined &&
      authority.daemonIdentity !== record.authority.daemonIdentity)
  )
    throw new Error("新窗口的运行服务或原生账号范围已改变，未选择替代会话。");
  sessionStorage.setItem(
    ownKey,
    JSON.stringify({ ...record, target, authority }),
  );
  const pending = parseSessionWindowRecord(
    localStorage.getItem(SESSION_WINDOW_INTENTS + id),
    id,
  );
  if (pending?.status === "ready" && pending.createdAt === record.createdAt)
    localStorage.removeItem(SESSION_WINDOW_INTENTS + id);
  const tabs = useAgentCenterStore.getState();
  const followed = tabs.cards.find(
    (card) => agentCardKey(card) === agentCardKey(target),
  );
  useAgentCenterStore.setState({
    currentAgentCardId: target.id,
    currentAgentCardKind: target.kind,
    detachedCard: followed ? null : target,
  });
  useAcpStore.getState().setActive(false);
  useAgentSettingsStore.getState().setSelectedAgent(target.kind);
  useWorkspaceStore.getState().setCwd(target.cwd!);
  useLayoutStore.getState().setActiveSidebarTab(target.kind);
  if (!own) {
    useLayoutStore.getState().setView("agent");
    useSessionSplitStore.getState().reset();
  }
  useSessionSplitStore
    .getState()
    .reconcile([
      ...tabs.cards.map(agentCardKey),
      ...(!followed ? [agentCardKey(target)] : []),
    ]);
  useSessionSplitStore.getState().focusKey(agentCardKey(target));
  if (target.kind === "codex") selectCodexInputTarget(target.id);
  else useCCStore.getState().switchToSession(target.id);
  return target;
}
