import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerMenu, SelectFilesMenuItem } from "./ComposerMenu";
import { useSessionDraftStore } from "@session/stores/useSessionDraftStore";
import {
  open,
  pickBrowserFiles,
  uploadBrowserFile,
} from "@session/browser-dialog";

const notices = vi.hoisted(() => ({ danger: vi.fn() }));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: notices,
}));

vi.mock("@session/browser-dialog", () => ({
  pickBrowserFiles: vi.fn(async () => null),
  uploadBrowserFile: vi.fn(),
  open: vi.fn(),
}));
const skills = vi.hoisted(() => ({ list: vi.fn(async () => []) }));
vi.mock("@session/services/codexService", () => ({ codexService: { listSkills: skills.list } }));
vi.mock("@session/stores/useWorkspaceStore", () => ({ useWorkspaceStore: (selector: (state: { cwd: string | null }) => unknown) => selector({ cwd: "/project" }) }));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: (selector: (state: { currentThreadId: string; threads: Array<{ id: string; cwd: string }> }) => unknown) =>
    selector({ currentThreadId: "owner", threads: [{ id: "owner", cwd: "/project" }] }),
}));
vi.mock("@session/hooks/useThreadModelSettings", () => ({
  useThreadModelSettings: () => ({
    webSearchRequest: false,
    setWebSearch: vi.fn(),
  }),
}));
vi.mock("./goalDrafts", () => ({
  useGoalDraft: () => ({ enabled: false, setEnabled: vi.fn() }),
}));
vi.mock("./mentions", () => ({
  useMentionItems: () => ({ items: [] }),
  mentionsWithIcon: (items: unknown[]) => items,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh" } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(open).mockReset();
  vi.mocked(pickBrowserFiles).mockReset().mockResolvedValue(null);
  vi.mocked(uploadBrowserFile).mockReset();
});
afterEach(() => vi.restoreAllMocks());

it("reads skills when the goal action opens and discards the result", async () => {
  render(<ComposerMenu owner="owner" />);
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  fireEvent.click(screen.getByRole("button", { name: "目标" }));
  await waitFor(() => expect(skills.list).toHaveBeenCalledWith("/project"));
  expect(screen.queryByText("技能")).toBeNull();
});

it("puts files, goal and sketch first without changing another draft", async () => {
  useSessionDraftStore.setState({ drafts: { "other-session": { text: "不要改这条草稿", revision: 4 } } });
  const goal = vi.fn();
  const sketch = vi.fn();
  render(<ComposerMenu owner="owner" onGoal={goal} onSketch={sketch} />);
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  const names = screen.getAllByRole("button").slice(1, 4).map((button) => button.getAttribute("aria-label") || button.textContent);
  expect(names.map((name) => name?.replace(/设定一个持续推进的目标|画一张草图/g, "").trim())).toEqual(["文件和文件夹", "目标", "草图"]);
  fireEvent.click(screen.getByRole("button", { name: "草图" }));
  expect(sketch).toHaveBeenCalledOnce();
  await waitFor(() => expect(skills.list).toHaveBeenCalledWith("/project"));
  expect(goal).not.toHaveBeenCalled();
  expect(useSessionDraftStore.getState().drafts["other-session"].text).toBe("不要改这条草稿");
});

it("does not repeat files or goal after the official first three actions", () => {
  render(<ComposerMenu owner="owner" />);
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  expect(screen.getAllByRole("button", { name: "文件和文件夹" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "目标" })).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "上传设备文件" })).toBeNull();
});

it("opens the shipped attach menu and leaves another session draft unchanged", () => {
  useSessionDraftStore.setState({
    drafts: { "other-session": { text: "不要改这条草稿", revision: 4 } },
  });
  render(<ComposerMenu owner="owner" />);
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  expect(screen.getByRole("button", { name: "附加照片或视频" })).toBeTruthy();
  expect(useSessionDraftStore.getState().drafts["other-session"]).toEqual({
    text: "不要改这条草稿",
    revision: 4,
  });
});

it.each(["picker rejected", "附件大小不能超过 10 MB", "upload failed"])(
  "reports a file picker failure (%s) without adding files or closing the menu",
  async (message) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(open).mockRejectedValueOnce(new Error(message));
    const selected = vi.fn(),
      after = vi.fn();
    render(
      <SelectFilesMenuItem onFilesSelected={selected} onAfterSelect={after} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "上传设备文件" }));
    await waitFor(() =>
      expect(notices.danger).toHaveBeenCalledExactlyOnceWith(
        "无法打开文件选择器",
      ),
    );
    expect(selected).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
  },
);

it("keeps cancellation silent and only accepts successfully selected paths", async () => {
  const selected = vi.fn(),
    after = vi.fn();
  vi.mocked(open)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(["/owned/file.txt"]);
  render(
    <SelectFilesMenuItem onFilesSelected={selected} onAfterSelect={after} />,
  );
  const button = screen.getByRole("button", { name: "上传设备文件" });
  fireEvent.click(button);
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  expect(selected).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() =>
    expect(selected).toHaveBeenCalledExactlyOnceWith(["/owned/file.txt"]),
  );
  expect(after).toHaveBeenCalledTimes(1);
  expect(notices.danger).not.toHaveBeenCalled();
});

it("reports a photo picker error without manufacturing an attachment", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(pickBrowserFiles).mockRejectedValueOnce(
    new Error("picker rejected"),
  );
  const selected = vi.fn();
  render(<ComposerMenu owner="owner" onImageFilesSelected={selected} />);
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  fireEvent.click(screen.getByRole("button", { name: "附加照片或视频" }));
  await waitFor(() =>
    expect(notices.danger).toHaveBeenCalledExactlyOnceWith(
      "无法打开文件选择器",
    ),
  );
  expect(selected).not.toHaveBeenCalled();
  expect(uploadBrowserFile).not.toHaveBeenCalled();
});

it("reports failure in the legacy photo upload fallback without retrying", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const file = new File(["image"], "photo.png", { type: "image/png" });
  vi.mocked(pickBrowserFiles).mockResolvedValueOnce([file]);
  vi.mocked(uploadBrowserFile).mockRejectedValueOnce(
    new Error("upload failed"),
  );
  const selected = vi.fn();
  render(<ComposerMenu owner="owner" onImagesSelected={selected} />);
  fireEvent.click(screen.getByRole("button", { name: "附加文件" }));
  fireEvent.click(screen.getByRole("button", { name: "附加照片或视频" }));
  await waitFor(() =>
    expect(notices.danger).toHaveBeenCalledExactlyOnceWith(
      "无法打开文件选择器",
    ),
  );
  expect(selected).not.toHaveBeenCalled();
  expect(uploadBrowserFile).toHaveBeenCalledTimes(1);
  expect(vi.mocked(uploadBrowserFile).mock.calls[0][0]).toBe(file);
});
