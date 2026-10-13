import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ComposerMenu } from "./ComposerMenu";
import { useSessionDraftStore } from "@session/stores/useSessionDraftStore";

vi.mock("@session/browser-dialog", () => ({
  pickBrowserFiles: vi.fn(async () => null),
  uploadBrowserFile: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@session/components/codex/stores", () => ({
  useCodexStore: (selector: (state: { currentThreadId: string }) => unknown) =>
    selector({ currentThreadId: "owner" }),
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
  useTranslation: () => ({ t: (key: string) => key }),
}));

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
