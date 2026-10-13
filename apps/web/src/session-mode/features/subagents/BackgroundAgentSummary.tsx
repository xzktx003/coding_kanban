import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSubagentStore } from "./store";
import { subagentService } from "./service";
import {
  backgroundAgentRows,
  backgroundAgentSummary,
} from "./backgroundSummary";
import {
  childState,
  descendants,
  inParentTurn,
  selectStopTargets,
} from "./model";
import { useCodexStore } from "@session/components/codex/stores";
import { ConfirmDialog } from "@session/components/ui/ConfirmDialog";
import { subagentScope } from "./scope";
import type { SubagentStopTarget } from "@agent-orchestrator/shared";

function accountOwner() {
  const { account, accountNamespace } = useCodexStore.getState();
  return JSON.stringify(
    account?.type === "chatgpt"
      ? [account.type, accountNamespace ?? account.email]
      : account,
  );
}
function currentStopTargets(root: string) {
  const { nodes } = useSubagentStore.getState(),
    { turnTimingMap } = useCodexStore.getState();
  const turn = turnTimingMap[root]?.turnId;
  return selectStopTargets(
    descendants(nodes, root)
      .filter((node) => node.verified)
      .map((node) => ({
        node,
        current: inParentTurn(nodes, root, node, turn),
        state: childState(node, turnTimingMap[node.thread.id], 0),
        turnId:
          turnTimingMap[node.thread.id]?.turnId ??
          node.thread.turns?.at(-1)?.id,
      })),
    false,
  );
}
const targetsKey = (targets: SubagentStopTarget[]) =>
  JSON.stringify(
    targets
      .map((t) => [t.threadId, t.turnId])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
type StopConfirmation = {
  root: string;
  round: string | undefined;
  epoch: number;
  scope: string;
  account: string;
  targets: SubagentStopTarget[];
  names: string[];
  invalidated?: boolean;
};
function confirmationCurrent(captured: StopConfirmation) {
  const state = useCodexStore.getState();
  return (
    state.currentThreadId === captured.root &&
    state.turnTimingMap[captured.root]?.turnId === captured.round &&
    useSubagentStore.getState().runtimeEpoch === captured.epoch &&
    subagentScope() === captured.scope &&
    accountOwner() === captured.account &&
    targetsKey(currentStopTargets(captured.root)) ===
      targetsKey(captured.targets)
  );
}

export function BackgroundAgentSummary({
  threadId,
}: {
  threadId: string | null;
}) {
  const nodes = useSubagentStore((state) => state.nodes);
  const timings = useCodexStore((state) => state.turnTimingMap);
  const rows = backgroundAgentRows(nodes, threadId, timings);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<StopConfirmation | null>(
    null,
  );
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => setConfirmation(null), [threadId]);
  useLayoutEffect(() => {
    if (!confirmation) return;
    // A late snapshot may restore an old identity. Once the confirmed scope
    // changes, returning to that identity cannot reauthorize the old list.
    const check = () => {
      if (!confirmation.invalidated && !confirmationCurrent(confirmation))
        confirmation.invalidated = true;
    };
    check();
    const stopCodex = useCodexStore.subscribe((next, previous) => {
      if (
        next.currentThreadId !== previous.currentThreadId ||
        next.account !== previous.account ||
        next.accountNamespace !== previous.accountNamespace ||
        next.turnTimingMap !== previous.turnTimingMap
      )
        check();
    });
    const stopSubagents = useSubagentStore.subscribe((next, previous) => {
      if (
        next.nodes !== previous.nodes ||
        next.runtimeEpoch !== previous.runtimeEpoch ||
        next.scope !== previous.scope
      )
        check();
    });
    return () => {
      stopCodex();
      stopSubagents();
    };
  }, [confirmation]);
  if (!threadId || rows.length === 0) return null;

  function requestStop() {
    if (!threadId || busy) return;
    const targets = currentStopTargets(threadId);
    if (!targets.length) {
      toast.message("本轮没有已确认可停止的子智能体");
      return;
    }
    setConfirmation({
      root: threadId,
      round: timings[threadId]?.turnId,
      epoch: useSubagentStore.getState().runtimeEpoch,
      scope: subagentScope(),
      account: accountOwner(),
      targets,
      names: targets.map(
        (t) =>
          nodes[t.threadId]?.thread.agentNickname ??
          nodes[t.threadId]?.thread.name ??
          t.threadId,
      ),
    });
  }
  async function confirmStop() {
    const captured = confirmation;
    if (!captured || lock.current) return;
    if (captured.invalidated || !confirmationCurrent(captured)) {
      setConfirmation(null);
      toast.message("任务范围已变化，请重新确认停止名单");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await subagentService.stop(captured.root, captured.targets);
      if (alive.current) setConfirmation(null);
    } catch (error) {
      toast.error(String(error));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }

  return (
    <section className="session-background-agents" aria-label="子智能体">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {backgroundAgentSummary(rows.length)}
        <span>{open ? "返回子智能体" : "打开子智能体"}</span>
      </button>
      {open && (
        <>
          <p>（使用 @ 标记智能体）</p>
          <ul>
            {rows.map((row) => (
              <li key={row.id}>
                <span>{row.title}</span>
                <span>{row.label}</span>
                {row.model && (
                  <span title={`使用 ${row.model}`}>{row.model}</span>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            title="停止此聊天中的所有子智能体"
            disabled={busy}
            onClick={requestStop}
          >
            全部停止
          </button>
        </>
      )}
      {confirmation && confirmation.root === threadId && (
        <ConfirmDialog
          isOpen
          title="停止本轮子智能体"
          description={`将停止本轮 ${confirmation.names.length} 个已确认的子智能体：${confirmation.names.join("、")}。`}
          confirmLabel="确认停止"
          onConfirm={() => void confirmStop()}
          onCancel={() => setConfirmation(null)}
          isLoading={busy}
        />
      )}
    </section>
  );
}
