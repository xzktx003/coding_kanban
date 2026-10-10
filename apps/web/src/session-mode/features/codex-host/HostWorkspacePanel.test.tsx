import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { HostWorkspacePanel } from "./HostWorkspacePanel";
import { editorHostWorkspace } from "./bridge";
vi.mock("./bridge", () => ({ editorHostWorkspace: vi.fn() }));
const a = { cwd: "/a", threadId: "thread-a", draftOwner: "workspace-draft-a" };
const value = {
  cwd: "/a",
  branch: "main",
  branches: ["main"],
  dirty: false,
  git: { available: true, repoRoot: "/a", mutationAllowed: true, reason: null },
  agents: { text: "saved", revision: "a".repeat(64), exists: true },
  recommendedSkills: [],
};
beforeEach(() =>
  vi.mocked(editorHostWorkspace).mockReset().mockResolvedValue(value),
);
test("unsaved project instructions survive closing the sheet and remain isolated by literal draft owner", async () => {
  const view = render(<HostWorkspacePanel owner={a} />);
  fireEvent.click(screen.getByRole("button", { name: "读取当前项目配置" }));
  const input = await screen.findByRole("textbox", { name: "项目 AGENTS.md" });
  fireEvent.change(input, {
    target: { value: "keep my pending instructions" },
  });
  view.unmount();
  const other = render(
    <HostWorkspacePanel
      owner={{ ...a, draftOwner: "workspace-draft-b", threadId: "thread-b" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "读取当前项目配置" }));
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "项目 AGENTS.md",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe("saved");
  other.unmount();
  render(<HostWorkspacePanel owner={a} />);
  fireEvent.click(screen.getByRole("button", { name: "读取当前项目配置" }));
  expect(
    (
      (await screen.findByRole("textbox", {
        name: "项目 AGENTS.md",
      })) as HTMLTextAreaElement
    ).value,
  ).toBe("keep my pending instructions");
});
test("plain projects show Git unavailable while reading and saving AGENTS remains usable", async () => {
  const owner = { ...a, cwd: "/plain", draftOwner: "plain-instructions" };
  vi.mocked(editorHostWorkspace).mockResolvedValueOnce({
    ...value,
    cwd: owner.cwd,
    branch: null,
    branches: [],
    dirty: null,
    git: {
      available: false,
      repoRoot: null,
      mutationAllowed: false,
      reason: "该项目不是 Git 仓库",
    },
  });
  render(<HostWorkspacePanel owner={owner} />);
  fireEvent.click(screen.getByRole("button", { name: "读取当前项目配置" }));
  expect(await screen.findByText("该项目不是 Git 仓库")).toBeTruthy();
  expect(screen.queryByText("游离 HEAD")).toBeNull();
  expect(screen.queryByRole("button", { name: "创建分支" })).toBeNull();
  const input = await screen.findByRole("textbox", { name: "项目 AGENTS.md" });
  fireEvent.change(input, { target: { value: "new plain instructions" } });
  vi.spyOn(window, "confirm").mockReturnValueOnce(true);
  vi.mocked(editorHostWorkspace).mockResolvedValueOnce({
    text: "new plain instructions",
    revision: "b".repeat(64),
    exists: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "保存 AGENTS.md" }));
  await act(async () => {});
  expect(editorHostWorkspace).toHaveBeenLastCalledWith(
    owner,
    expect.objectContaining({
      action: "instructions",
      text: "new plain instructions",
      confirmed: true,
    }),
  );
});
test("ancestor repository is displayed and all Git mutations are disabled for the captured nested project", async () => {
  const owner = { ...a, cwd: "/repo/nested", draftOwner: "ancestor-git" };
  vi.mocked(editorHostWorkspace).mockResolvedValueOnce({
    ...value,
    cwd: owner.cwd,
    branches: ["main", "feature"],
    git: {
      available: true,
      repoRoot: "/repo",
      mutationAllowed: false,
      reason: "Git 仓库位于当前项目外",
    },
  });
  render(<HostWorkspacePanel owner={owner} />);
  fireEvent.click(screen.getByRole("button", { name: "读取当前项目配置" }));
  expect(await screen.findByText("/repo")).toBeTruthy();
  expect(screen.getByText("Git 仓库位于当前项目外")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "分支名称" }), {
    target: { value: "feature" },
  });
  for (const name of ["创建分支", "切换分支", "创建独立工作区"])
    expect(
      (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
    ).toBe(true);
});
test("a late configuration read cannot populate the newly selected owner", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(editorHostWorkspace).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(
    <HostWorkspacePanel owner={{ ...a, draftOwner: "late-a" }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "读取当前项目配置" }));
  view.rerender(
    <HostWorkspacePanel
      owner={{ ...a, cwd: "/b", draftOwner: "late-b", threadId: "thread-b" }}
    />,
  );
  await act(async () => {
    finish(value);
  });
  expect(screen.queryByRole("textbox", { name: "项目 AGENTS.md" })).toBeNull();
});
