import { beforeEach, expect, it } from "vitest";
import { useAgentCenterStore } from "@session/stores/useAgentCenterStore";
import { useSessionAttentionStore } from "@session/stores/useSessionAttentionStore";
import { useApprovalStore } from "../stores/useApprovalStore";
import { useRequestUserInputStore } from "../stores/useRequestUserInputStore";
import { adjacentFollowedCard, nextAttentionCard } from "./nextAttention";

beforeEach(() => {
  useAgentCenterStore.setState({
    cards: [
      { kind: "codex", id: "current" },
      { kind: "codex", id: "quiet" },
      { kind: "codex", id: "unread" },
      { kind: "codex", id: "waiting" },
    ],
  } as never);
  useSessionAttentionStore.setState({ receipts: {} });
  useApprovalStore.setState({ pendingApprovals: [], currentApproval: null });
  useRequestUserInputStore.setState({
    pendingRequests: [],
    currentRequest: null,
  });
});

it("moves to the previous followed chat and stops at the first tab", () => {
  useAgentCenterStore.setState({ currentAgentCardId: "quiet" } as never);
  expect(adjacentFollowedCard(-1)?.id).toBe("current");
  useAgentCenterStore.setState({ currentAgentCardId: "current" } as never);
  expect(adjacentFollowedCard(-1)).toBeNull();
  expect(adjacentFollowedCard(1)?.id).toBe("quiet");
});

it("picks the next unread or waiting chat after the current tab", () => {
  useSessionAttentionStore.getState().complete("codex", "unread", "reply-1");
  useAgentCenterStore.setState({ currentAgentCardId: "current" } as never);
  expect(nextAttentionCard()?.id).toBe("unread");
  useRequestUserInputStore.setState({
    pendingRequests: [
      {
        requestId: 1 as never,
        threadId: "waiting",
        turnId: "turn",
        itemId: "item",
        questions: [{ id: "q", question: "继续吗" }],
      },
    ],
  });
  useAgentCenterStore.setState({ currentAgentCardId: "unread" } as never);
  expect(nextAttentionCard()?.id).toBe("waiting");
  useAgentCenterStore.setState({ currentAgentCardId: "waiting" } as never);
  expect(nextAttentionCard()?.id).toBe("unread");
  useAgentCenterStore.setState({ currentAgentCardId: "quiet" } as never);
  expect(nextAttentionCard()?.id).toBe("unread");
  useSessionAttentionStore.setState({ receipts: {} });
  useRequestUserInputStore.setState({ pendingRequests: [], currentRequest: null });
  useAgentCenterStore.setState({ currentAgentCardId: "current" } as never);
  expect(nextAttentionCard()).toBeNull();
});
