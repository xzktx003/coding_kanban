import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThreadSources } from "./ThreadSources";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { openEventStream } from "@session/lib/eventStream";

vi.mock("./ThreadSourcesPanel", () => ({ default: () => <div role="dialog">Captured sources</div> }));
vi.mock("@session/lib/eventStream", () => ({ openEventStream: vi.fn(() => () => {}) }));
vi.mock("@session/session-dom", () => ({ useAgentInteractionVisible: () => true }));
afterEach(() => vi.mocked(openEventStream).mockClear());

it("closes the captured catalogue and releases its local consumer when the account namespace changes", async () => {
  useCodexStore.setState({ accountNamespace: "account-a" });
  render(<ThreadSources threadId="owner" events={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "查看会话来源" }));
  await screen.findByRole("dialog");
  act(() => useCodexStore.setState({ accountNamespace: "account-b" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("revokes even a same-account confirmation or a stream reset instead of keeping old file actions", async () => {
  render(<ThreadSources threadId="owner" events={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "查看会话来源" }));
  await screen.findByRole("dialog");
  const signals = vi.mocked(openEventStream).mock.calls[0]?.[0];
  expect(signals).toBeTruthy();
  act(() => signals!.onEvent({ seq: 1, event: "codex:notification", payload: { method: "account/updated", params: {} } }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
