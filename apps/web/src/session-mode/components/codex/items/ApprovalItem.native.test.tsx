import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ApprovalRequest } from "../stores/useApprovalStore";
import { useApprovalStore } from "../stores/useApprovalStore";
import {
  resetRpcLifecycle,
  rpcKey,
  useRpcDeliveryStore,
} from "../stores/rpcLifecycle";
import { ApprovalItem } from "./ApprovalItem";
import { useCodexStore } from "../stores/useCodexStore";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const request = (
  extra = {},
): Extract<ApprovalRequest, { type: "commandExecution" }> => ({
  type: "commandExecution",
  requestId: 8,
  threadId: "owner",
  turnId: "turn",
  itemId: "item",
  startedAtMs: 1,
  environmentId: null,
  command: "curl https://example.org/data",
  cwd: "/owner/project",
  reason: "Fetch the requested dataset",
  proposedExecpolicyAmendment: ["curl"],
  ...extra,
});
function seed(value: ApprovalRequest) {
  const respond = vi.fn().mockResolvedValue(undefined);
  useApprovalStore.setState({
    pendingApprovals: [value],
    currentApproval: value,
    respondToApproval: respond,
  });
  return respond;
}
beforeEach(() => {
  resetRpcLifecycle();
  useCodexStore.setState({ events: {} });
});

it("shows the real command, owner cwd and reason, and once approval stays once", async () => {
  const value = request(),
    respond = seed(value);
  render(<ApprovalItem currentThreadId="owner" />);
  expect(screen.getByText(value.command!)).toBeTruthy();
  expect(screen.getByText("/owner/project")).toBeTruthy();
  expect(screen.getByText(value.reason!)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "approval.approveOnce" }));
  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith(8, true, "accept", value),
  );
});

it("offers only native allowed decisions, with the exact network amendment", async () => {
  const decision = {
    applyNetworkPolicyAmendment: {
      network_policy_amendment: {
        host: "example.org",
        action: "allow" as const,
      },
    },
  };
  const value = request({
    networkApprovalContext: { host: "example.org", protocol: "https" },
    availableDecisions: [decision, "cancel"],
  });
  const respond = seed(value);
  render(<ApprovalItem currentThreadId="owner" />);
  expect(screen.getByText("https://example.org")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "approval.approveOnce" }),
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "common.decline" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "approval.alwaysAllowHost" }),
  );
  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith(8, true, decision, value),
  );
});

it("an explicit empty allowed-decision list never invents approval scopes", () => {
  seed(request({ availableDecisions: [] }));
  render(<ApprovalItem currentThreadId="owner" />);
  expect(
    screen.queryByRole("button", { name: "approval.approveOnce" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "approval.approveForSession" }),
  ).toBeNull();
  expect(screen.getByText("approval.noDecisions")).toBeTruthy();
});

it("uncertain delivery disables decision controls and keeps the status check", () => {
  const value = request({ availableDecisions: ["accept", "decline"] });
  const respond = seed(value);
  useRpcDeliveryStore.setState({
    states: {
      [rpcKey(value)]: { phase: "uncertain", message: "回答送达尚未确认" },
    },
  });
  render(<ApprovalItem currentThreadId="owner" />);
  const approve = screen.getByRole("button", {
    name: "approval.approveOnce",
  }) as HTMLButtonElement;
  expect(approve.disabled).toBe(true);
  fireEvent.click(approve);
  expect(respond).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "核对状态" })).toBeTruthy();
});

it("a long command can expand, and changing request identity resets the preview", async () => {
  const long = request({ command: "one\ntwo\nthree\nfour\nfive" });
  seed(long);
  render(<ApprovalItem currentThreadId="owner" />);
  const expand = screen.getByRole("button", { name: "approval.expandCommand" });
  expect(expand.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(expand);
  expect(
    screen
      .getByRole("button", { name: "approval.collapseCommand" })
      .getAttribute("aria-expanded"),
  ).toBe("true");
  await act(async () => {
    seed({ ...long, requestId: 9 });
  });
  expect(
    screen
      .getByRole("button", { name: "approval.expandCommand" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});

it("keeps older argv-style approval requests readable without crashing or losing identity", () => {
  const value = request({ command: ["pwd", "--logical"] });
  const respond = seed(value);
  render(<ApprovalItem currentThreadId="owner" />);
  expect(screen.getByText("pwd --logical")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "common.decline" }));
  expect(respond).toHaveBeenCalledWith(8, true, "decline", value);
});

it("approval shortcuts operate on the focused visible request; Escape only closes", async () => {
  const value = request({ availableDecisions: ["accept", "decline"] });
  const respond = seed(value);
  render(<ApprovalItem currentThreadId="owner" />);
  const panel = document.querySelector<HTMLElement>(
    "[data-codex-approval-surface]",
  )!;
  fireEvent.keyDown(panel, { key: "Escape" });
  expect(respond).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "approval.expandRequest" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "approval.expandRequest" }),
  );
  fireEvent.keyDown(panel, { key: "Enter" });
  await waitFor(() =>
    expect(respond).toHaveBeenCalledWith(8, true, "accept", value),
  );
});

it("patch approval shows the exact awaiting item diff and ignores another owner or turn", () => {
  const patch: ApprovalRequest = {
    type: "fileChange",
    requestId: 10,
    threadId: "owner",
    turnId: "turn",
    itemId: "patch",
    startedAtMs: 1,
  };
  seed(patch);
  const event = (threadId: string, turnId: string, path: string) =>
    ({
      method: "item/started",
      params: {
        threadId,
        turnId,
        item: {
          id: "patch",
          type: "fileChange",
          changes: [
            {
              path,
              kind: { type: "update", move_path: null },
              diff: "@@ -42,1 +42,1 @@\n-old\n+new\n",
            },
          ],
        },
      },
    }) as any;
  useCodexStore.setState({
    events: {
      owner: [
        event("foreign", "turn", "wrong-owner"),
        event("owner", "old", "wrong-turn"),
        event("owner", "turn", "src/right.ts"),
      ],
    },
  });
  render(<ApprovalItem currentThreadId="owner" />);
  expect(screen.getByText("src/right.ts")).toBeTruthy();
  expect(screen.queryByText("wrong-owner")).toBeNull();
  expect(screen.queryByText("wrong-turn")).toBeNull();
  expect(document.querySelector('[data-new-line="42"]')).toBeTruthy();
});
it("approvals preserve native added and deleted file contents without requiring hunk headers", () => {
  seed({
    type: "fileChange",
    requestId: 11,
    threadId: "owner",
    turnId: "turn",
    itemId: "raw-patch",
    startedAtMs: 1,
  });
  useCodexStore.setState({
    events: {
      owner: [
        {
          method: "item/started",
          params: {
            threadId: "owner",
            turnId: "turn",
            item: {
              id: "raw-patch",
              type: "fileChange",
              status: "inProgress",
              changes: [
                {
                  path: "new.txt",
                  kind: { type: "add" },
                  diff: "added native content\n",
                },
                {
                  path: "gone.txt",
                  kind: { type: "delete" },
                  diff: "deleted native content\n",
                },
              ],
            },
          },
        } as any,
      ],
    },
  });
  render(<ApprovalItem currentThreadId="owner" />);
  expect(screen.getByText("added native content")).toBeTruthy();
  expect(screen.getByText("deleted native content")).toBeTruthy();
});
