import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "@session/locales/zh";
import { ApprovalItem } from "./ApprovalItem";
import { useApprovalStore } from "../stores/useApprovalStore";
import { useSessionDraftStore } from "@session/stores/useSessionDraftStore";
import { useCodexStore } from "../stores/useCodexStore";

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: "zh", resources: { zh: { thread: zh.thread } } });
});

it("approves once with the plugin label and leaves another session draft unchanged", async () => {
  const respond = vi.fn().mockResolvedValue(undefined);
  const request = {
    type: "commandExecution" as const,
    requestId: 11,
    threadId: "owner",
    turnId: "turn",
    itemId: "item",
    startedAtMs: 1,
    environmentId: null,
    command: "pnpm test",
    cwd: "/fixture",
    reason: "检查范围",
    proposedExecpolicyAmendment: [],
  };
  useCodexStore.setState({ events: {} });
  useApprovalStore.setState({
    pendingApprovals: [request],
    currentApproval: request,
    respondToApproval: respond,
  });
  useSessionDraftStore.setState({
    drafts: { "other-session": { text: "不要改这条草稿", revision: 5 } },
  });
  render(<ApprovalItem currentThreadId="owner" />);
  fireEvent.click(screen.getByRole("button", { name: "允许一次" }));
  await waitFor(() => {
    expect(respond).toHaveBeenCalledWith(11, true, "accept", request);
  });
  expect(useSessionDraftStore.getState().drafts["other-session"]).toEqual({
    text: "不要改这条草稿",
    revision: 5,
  });
});
