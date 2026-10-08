import { lazy, Suspense, useEffect, useState } from "react";
import { useSessionTabActions } from "@session/hooks/useSessionTabs";
import { useIsMobile } from "@session/hooks/use-mobile";
import {
  agentCardKey,
  useAgentCenterStore,
} from "@session/stores/useAgentCenterStore";
import {
  splitGroups,
  useSessionSplitStore,
  type SessionGroup,
  type SessionSplitNode,
  type SplitEdge,
} from "@session/stores/useSessionSplitStore";
import { codexService } from "@session/services/codexService";
import { useCodexStore } from "../codex/stores";
import {
  ResizablePanel,
  ResizablePanelGroup,
  ResizableHandle,
} from "../ui/resizable";
import { SessionWelcome } from "@session/SessionWelcome";
import { SessionTabs, sessionTabDrag } from "./SessionTabs";
const CodexThread = lazy(() =>
  import("../codex/thread/CodexThread").then((m) => ({
    default: m.CodexThread,
  })),
);
const CCSession = lazy(() => import("../cc/session/CCSession"));

function GroupView({ group }: { group: SessionGroup }) {
  const tabs = useAgentCenterStore();
  const layout = useSessionSplitStore();
  const { selectTab } = useSessionTabActions();
  const [edge, setEdge] = useState<SplitEdge | null>(null);
  const focused = group.id === layout.activeGroupId;
  const key = focused && !tabs.currentAgentCardId ? null : group.selected;
  const card =
    tabs.cards.find((c) => agentCardKey(c) === key) ??
    (tabs.detachedCard && agentCardKey(tabs.detachedCard) === key
      ? tabs.detachedCard
      : undefined);
  useEffect(() => {
    if (card?.kind === "codex") {
      const state = useCodexStore.getState();
      if (!state.historyLoadedMap[card.id] && !state.historyLoadingMap[card.id])
        void codexService
          .threadResume(card.id, undefined, { background: true })
          .catch(() => {});
    }
  }, [card?.kind, card?.id]);
  return (
    <section
      data-session-group={group.id}
      data-group-active={focused}
      className="session-window-group"
      onClick={() => {
        if (card && !focused && window.getSelection()?.isCollapsed !== false)
          void selectTab(card);
      }}
    >
      <SessionTabs groupId={group.id} />
      <div
        className="session-window-body"
        data-session-group-body
        onDragOver={(e) => {
          if (!sessionTabDrag.key) return;
          e.preventDefault();
          e.stopPropagation();
          const b = e.currentTarget.getBoundingClientRect(),
            x = (e.clientX - b.x) / b.width,
            y = (e.clientY - b.y) / b.height;
          setEdge(
            x < 0.22
              ? "left"
              : x > 0.78
                ? "right"
                : y < 0.22
                  ? "top"
                  : y > 0.78
                    ? "bottom"
                    : "center",
          );
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setEdge(null);
        }}
        onDrop={(e) => {
          if (!sessionTabDrag.key) return;
          e.preventDefault();
          e.stopPropagation();
          const source = tabs.cards.find(
            (c) => agentCardKey(c) === sessionTabDrag.key,
          );
          if (source) {
            layout.place(agentCardKey(source), group.id, edge ?? "center");
            void selectTab(source);
          }
          sessionTabDrag.key = null;
          setEdge(null);
        }}
      >
        {card ? (
          <Suspense
            fallback={
              <div role="status" className="session-transcript-loading">
                <span>正在加载会话…</span>
                <div aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            }
          >
            {card.kind === "codex" ? (
              <CodexThread threadId={card.id} />
            ) : (
              <CCSession sessionId={card.id} disableListener />
            )}
          </Suspense>
        ) : (
          <div className="p-4">
            <SessionWelcome />
          </div>
        )}
        {edge && (
          <div className="session-split-drop" data-edge={edge}>
            松开以{edge === "center" ? "移动到此窗口组" : "分屏"}
          </div>
        )}
      </div>
    </section>
  );
}
function SplitNode({ node }: { node: SessionSplitNode }) {
  const resize = useSessionSplitStore((s) => s.resize);
  if (node.type === "group") return <GroupView group={node} />;
  return (
    <ResizablePanelGroup
      direction={node.direction}
      id={node.id}
      onLayout={(sizes) => {
        if (Math.abs(sizes[0] - node.ratio) > 0.1) resize(node.id, sizes[0]);
      }}
    >
      <ResizablePanel
        id={node.first.id}
        order={0}
        defaultSize={node.ratio}
        minSize={15}
      >
        <SplitNode node={node.first} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id={node.second.id}
        order={1}
        defaultSize={100 - node.ratio}
        minSize={15}
      >
        <SplitNode node={node.second} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
export function SessionGroups() {
  const tabs = useAgentCenterStore();
  const layout = useSessionSplitStore();
  const mobile = useIsMobile();
  useEffect(() => {
    const effective = [
      ...tabs.cards,
      ...(tabs.detachedCard ? [tabs.detachedCard] : []),
    ];
    layout.reconcile(effective.map(agentCardKey));
    if (tabs.currentAgentCardId)
      layout.focusKey(
        `${tabs.currentAgentCardKind ?? "codex"}:${tabs.currentAgentCardId}`,
      );
  }, [
    tabs.cards,
    tabs.detachedCard,
    tabs.currentAgentCardId,
    tabs.currentAgentCardKind,
  ]);
  const groups = splitGroups(layout.tree),
    current = groups.find((g) => g.id === layout.activeGroupId) ?? groups[0];
  return (
    <div className="session-split-workspace">
      <div className="flex-1 min-h-0 overflow-hidden">
        {mobile ? (
          <GroupView group={current} />
        ) : layout.tree.type === "group" ? (
          <GroupView group={layout.tree} />
        ) : (
          <SplitNode node={layout.tree} />
        )}
      </div>
    </div>
  );
}
