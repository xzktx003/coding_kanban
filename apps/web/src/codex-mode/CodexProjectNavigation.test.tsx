import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodexProjectNavigation } from "./CodexProjectNavigation";

it("searches collapsed projects instead of declaring unloaded history empty", async () => {
  const ensure = vi.fn();
  render(
    <CodexProjectNavigation
      projects={["/tmp/alpha", "/tmp/beta"]}
      projectsLoading={false}
      projectsError={null}
      selectedProject="/tmp/alpha"
      conversationStates={{
        "/tmp/alpha": { loading: false, error: null, conversations: [] },
      }}
      canResume
      openingThreadIds={[]}
      openThreadIds={[]}
      mobilePane="native"
      onDismiss={vi.fn()}
      onSelectProject={vi.fn()}
      onRetryProjects={vi.fn()}
      onRetryConversations={vi.fn()}
      onOpenConversation={vi.fn()}
      onNewChat={vi.fn()}
      onEnsureProject={ensure}
    />,
  );
  ensure.mockClear();
  fireEvent.change(screen.getByRole("textbox", { name: "搜索会话" }), {
    target: { value: "missing title" },
  });
  await waitFor(() => expect(ensure).toHaveBeenCalledWith("/tmp/beta"));
  expect(screen.queryByText("没有匹配的项目或会话。")).toBeNull();
  expect(screen.getByText("正在检索全部项目…")).toBeTruthy();
});
