import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  ccRead: vi.fn(),
  acpRead: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/cc", () => ({
  ccReadSessionTranscript: api.ccRead,
}));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpReadSessionTranscript: api.acpRead,
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: () => () => {},
}));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => true,
}));
import { ProviderHistoryDetail } from "./ProviderHistoryDetail";
import { refreshClaudeHistory } from "@session/services/followedSessionAuxSync";
import {
  refreshAcpTranscript,
  acpTranscriptOwner,
} from "@session/services/acpTranscriptRead";
import { invalidateCodexOperationScope } from "@session/services/codexOperationScope";
import { useProviderTranscriptStore } from "@session/services/sessionProviderTranscriptState";
import { useCCStore } from "@session/stores/cc";
import { useAcpStore } from "@session/stores/useAcpStore";
import { usePairingStore } from "@session/stores/usePairingStore";
import { SessionApiError } from "@session/services/apiAdapt/shared";

const target = {
  agentId: "fixture-agent",
  connectionId: "fixture-connection",
  sessionId: "native-same",
  historySessionId: "acph_same",
};
const itemId = "exact-source-item";
const ccPage = () => ({
  data: [
    {
      type: "assistant",
      uuid: itemId,
      session_id: "cc-source",
      truncated: true,
      historyDetail: { itemId },
      message: {
        role: "assistant",
        content: [{ type: "text", text: "same bounded preview" }],
      },
    },
  ],
  projection: "cc-messages",
  revision: "same-source",
  nextCursor: null,
  truncated: true,
});
const acpPage = () => ({
  data: [
    {
      id: "acp-1-0",
      role: "agent",
      text: "same bounded preview",
      historySourceId: 1,
      truncated: true,
      historyDetail: { itemId },
    },
  ],
  projection: "acp-entries",
  revision: "same-source",
  nextCursor: null,
  truncated: true,
  metadata: { historySourceId: 1 },
});
const part = (text: string) =>
  new Response(
    JSON.stringify({
      text,
      format: "json",
      nextOffset: null,
      revision: "source",
      itemRevision: "a".repeat(64),
    }),
    { headers: { "content-type": "application/json" } },
  );

beforeEach(() => {
  api.ccRead.mockReset();
  api.acpRead.mockReset();
  api.detail.mockReset();
  useProviderTranscriptStore.setState({ entries: {}, revision: 0 });
  useAcpStore.getState().reset();
  useAcpStore.setState({ ...target, runtimeInstance: "fixture-runtime" });
  useCCStore.setState({
    activeSessionId: "cc-source",
    messages: [],
    sessionMessagesMap: {},
    sessionLoadingMap: {},
  });
  usePairingStore.setState({
    desktops: [{ name: "fixture", host: "fixture", port: 3333, token: "old" }],
    selectedHost: "fixture",
  });
  vi.stubGlobal("fetch", api.detail);
});
afterEach(() => vi.unstubAllGlobals());

for (const provider of ["cc", "acp"] as const)
  for (const revokeDuringConfirmation of [false, true]) {
    it(`${provider} only reopens the same item after an actual new readonly page confirms its source${revokeDuringConfirmation ? "; changed token cancels the first confirmation" : ""}`, async () => {
      const read = provider === "cc" ? api.ccRead : api.acpRead;
      const page = provider === "cc" ? ccPage : acpPage;
      read.mockResolvedValueOnce(page());
      const refresh = (signal?: AbortSignal) =>
        provider === "cc"
          ? refreshClaudeHistory("cc-source", signal)
          : refreshAcpTranscript(target, signal);
      await refresh();
      const sourceId =
        provider === "cc" ? "cc-source" : target.historySessionId;
      const owner =
        provider === "cc" ? "cc:cc-source" : acpTranscriptOwner(target);
      function Source() {
        const row =
          provider === "cc"
            ? useCCStore((s) => s.sessionMessagesMap["cc-source"]?.[0])
            : useAcpStore((s) => s.entries[0]);
        return (
          <ProviderHistoryDetail
            {...({
              provider,
              sessionId: sourceId,
              itemId,
              sourceOwner: owner,
              sourceRow: row,
              onConfirmSource: (_scope: unknown, signal: AbortSignal) =>
                refresh(signal),
            } as any)}
          />
        );
      }
      api.detail
        .mockResolvedValueOnce(part("original full detail"))
        .mockResolvedValueOnce(part("newly confirmed full detail"));
      render(<Source />);
      fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
      await screen.findByText("original full detail");
      fireEvent.click(screen.getByRole("button", { name: "关闭完整内容" }));
      invalidateCodexOperationScope();
      fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
      await act(async () => {});
      expect(api.detail).toHaveBeenCalledTimes(1);
      let release!: (page: unknown) => void;
      read.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      fireEvent.click(screen.getByRole("button", { name: "重新核对来源" }));
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(api.detail).toHaveBeenCalledTimes(1);
      if (revokeDuringConfirmation) {
        act(() =>
          usePairingStore.setState({
            desktops: [
              { name: "fixture", host: "fixture", port: 3333, token: "new" },
            ],
          }),
        );
        await waitFor(() =>
          expect(read.mock.calls[1][1].signal.aborted).toBe(true),
        );
      }
      await act(async () => release(page()));
      if (revokeDuringConfirmation) {
        await screen.findByText("连接已变化，请重新核对消息来源。");
        fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
        await act(async () => {});
        expect(api.detail).toHaveBeenCalledTimes(1);
        read.mockResolvedValueOnce(page());
        fireEvent.click(screen.getByRole("button", { name: "重新核对来源" }));
        await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
      }
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: "查看完整内容" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
      await screen.findByText("newly confirmed full detail");
      expect(api.detail).toHaveBeenCalledTimes(2);
      expect(JSON.parse(api.detail.mock.calls[1][1].body)).toMatchObject({
        session_id: sourceId,
        item_id: itemId,
      });
    });
  }

for (const provider of ["cc", "acp"] as const)
  for (const rejected of [false, true]) {
    it(`${provider} confirms an older visible item's original page instead of the unrelated recent page${rejected ? "; an invalid cursor requires explicit source selection" : ""}`, async () => {
      const read = provider === "cc" ? api.ccRead : api.acpRead;
      const page = provider === "cc" ? ccPage : acpPage;
      const cursor = "opaque-earlier-page-locator";
      const refresh = (signal?: AbortSignal, readCursor?: string) =>
        provider === "cc"
          ? refreshClaudeHistory("cc-source", signal, "interactive", readCursor)
          : refreshAcpTranscript(target, signal, "interactive", readCursor);
      read.mockResolvedValueOnce(page());
      await refresh(undefined, cursor);
      const sourceId =
        provider === "cc" ? "cc-source" : target.historySessionId;
      const owner =
        provider === "cc" ? "cc:cc-source" : acpTranscriptOwner(target);
      function Source() {
        const row =
          provider === "cc"
            ? useCCStore((s) => s.sessionMessagesMap["cc-source"]?.[0])
            : useAcpStore((s) => s.entries[0]);
        return (
          <ProviderHistoryDetail
            {...({
              provider,
              sessionId: sourceId,
              itemId,
              sourceOwner: owner,
              sourceRow: row,
              onConfirmSource: (
                _scope: unknown,
                signal: AbortSignal,
                readCursor?: string,
              ) => refresh(signal, readCursor),
            } as any)}
          />
        );
      }
      render(<Source />);
      invalidateCodexOperationScope();
      fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
      expect(api.detail).not.toHaveBeenCalled();
      if (rejected)
        read.mockRejectedValueOnce(
          new SessionApiError("old page cursor rejected", 409),
        );
      else read.mockResolvedValueOnce(page());
      fireEvent.click(screen.getByRole("button", { name: "重新核对来源" }));
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(read.mock.calls[1][1].cursor).toBe(cursor);
      if (rejected) {
        await screen.findByText(
          "此历史页的来源已变化，请重新选择历史会话或历史页后查看。",
        );
        expect(read).toHaveBeenCalledTimes(2);
        expect(api.detail).not.toHaveBeenCalled();
        return;
      }
      api.detail.mockResolvedValueOnce(part("confirmed older detail"));
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: "查看完整内容" })
            .hasAttribute("disabled"),
        ).toBe(false),
      );
      fireEvent.click(screen.getByRole("button", { name: "查看完整内容" }));
      await screen.findByText("confirmed older detail");
      expect(api.detail).toHaveBeenCalledTimes(1);
    });
  }
