import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ epoch: 1, load: vi.fn(), finish: null as (() => void) | null }));
vi.mock("@session/services/codexOperationScope", () => ({ captureCodexOperationScope: () => ({ revision: state.epoch }), isCodexOperationScopeCurrent: (scope: any) => scope.revision === state.epoch }));
vi.mock("@session/session-dom", () => ({ isSessionInteractionVisible: () => true, useSessionInteractionVisible: () => true }));
vi.mock("@session/stores/useInputStore", () => ({ activeDraftOwner: () => "owner" }));
vi.mock("./ConversationMenu", async () => {
  state.load();
  await new Promise<void>((resolve) => { state.finish = resolve; });
  return { ConversationMenu: ({ initialCommand }: any) => <p>Command: {initialCommand?.kind ?? "none"}</p> };
});
import { DeferredConversationMenu } from "./DeferredConversationMenu";

it("loads on a targeted shortcut while discarding the old command if its runtime changes during import", async () => {
  const origin = document.createElement("form"); document.body.append(origin);
  render(<DeferredConversationMenu threadId="thread" draftOwner="owner" composerRef={{ current: origin }} title="Current" triggerContainer={null} ownsGlobalShortcuts />);
  expect(state.load).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "p", code: "KeyP", ctrlKey: true, altKey: true });
  await waitFor(() => expect(state.load).toHaveBeenCalledTimes(1));
  state.epoch++;
  await act(async () => state.finish?.());
  await screen.findByText("Command: none");
  origin.remove();
});
