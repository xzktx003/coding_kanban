import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@session/services/apiAdapt/acp", () => ({
  acpReadSessionTranscript: (...args: unknown[]) => api.read(...args),
}));
vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => true,
}));
vi.mock("@session/lib/eventStream",()=>({openEventStream:()=>()=>{}}));
import { useAcpStore } from "@session/stores/useAcpStore";
import { AcpReadonlyHistoryPanel } from "./AcpReadonlyHistoryPanel";
import { useProviderTranscriptStore } from "@session/services/sessionProviderTranscriptState";
beforeEach(() => {
  api.read.mockReset();
  useAcpStore.getState().reset();
  useAcpStore.setState({
    agentId: "agent",
    connectionId: "connection",
    sessionId: "new-session",
  });
  useProviderTranscriptStore.setState({ entries: {} });
});
const source = { sessionId: "old-session", title: "Original", cwd: "/source" };
const target = {
  agentId: "agent",
  connectionId: "connection",
  sessionId: "new-session",
};
it("shows bounded old records as readonly context while the native composer target stays the new session", async () => {
  api.read.mockResolvedValue({
    projection: "acp-entries",
    data: [{ id: "old-1", role: "agent", text: "old answer" }],
    nextCursor: "earlier",
    truncated: false,
    revision: "one",
    metadata: {},
  });
  const view = render(
    <AcpReadonlyHistoryPanel source={source} target={target} />,
  );
  await screen.findByText("old answer");
  expect(screen.getByText(/不包含在新会话上下文/)).toBeTruthy();
  expect(api.read.mock.calls[0][0]).toBe("old-session");
  expect(useAcpStore.getState().sessionId).toBe("new-session");
  expect(useAcpStore.getState().entries).toEqual([]);
  expect(
    Object.values(useProviderTranscriptStore.getState().entries).some(
      (entry) => entry.externalBodyBytes! > 0,
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "收起旧记录" }));
  await waitFor(() => expect(screen.queryByText("old answer")).toBeNull());
  expect(
    Object.values(useProviderTranscriptStore.getState().entries).every(
      (entry) => (entry.externalBodyBytes ?? 0) === 0,
    ),
  ).toBe(true);
  view.unmount();
});
it("cancels late old-source replies after the viewer target changes", async () => {
  let resolve!: (page: unknown) => void;
  api.read.mockReturnValue(new Promise((r) => (resolve = r)));
  const view = render(
    <AcpReadonlyHistoryPanel source={source} target={target} />,
  );
  await waitFor(() => expect(api.read).toHaveBeenCalledOnce());
  act(() => useAcpStore.setState({ sessionId: "another-target" }));
  await act(async () =>
    resolve({
      projection: "acp-entries",
      data: [{ id: "old-1", role: "agent", text: "late old body" }],
      nextCursor: null,
      truncated: false,
      revision: "one",
      metadata: {},
    }),
  );
  expect(screen.queryByText("late old body")).toBeNull();
  expect(useAcpStore.getState().sessionId).toBe("another-target");
  view.unmount();
});

it("cannot publish the old source page after a same-account lifetime was revoked",async()=>{
 const {invalidateCodexOperationScope}=await import("@session/services/codexOperationScope");
 let resolve!:(value:unknown)=>void;api.read.mockReturnValue(new Promise(r=>resolve=r));
 const view=render(<AcpReadonlyHistoryPanel source={source} target={target}/>);
 await waitFor(()=>expect(api.read).toHaveBeenCalledOnce());
 invalidateCodexOperationScope();
 await act(async()=>{resolve({projection:"acp-entries",data:[{id:"old",role:"agent",text:"revoked old account content"}],nextCursor:null,truncated:false,revision:"revoked",metadata:{}});});
 expect(screen.queryByText("revoked old account content")).toBeNull();view.unmount();
});
