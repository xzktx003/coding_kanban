import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  observeConfigNotice,
  useNativeConfigNoticeStore,
} from "./config-notices";
import { NativeConfigNotices } from "./NativeConfigNotices";
import { useServerNotificationHandler } from "@session/components/codex/hooks/useServerNotificationHandler";
const reads = vi.hoisted(() => vi.fn());
vi.mock("@session/services/apiAdapt/filesystem", () => ({
  readTextFile: reads,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: any) =>
      `${key}${values ? JSON.stringify(values) : ""}`,
  }),
}));
vi.mock("@session/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
const warning = (
  summary = "Fixture config warning",
  path: string | null = null,
) => ({
  method: "configWarning",
  params: {
    summary,
    details: "Use `safe` config",
    ...(path
      ? {
          path,
          range: { start: { line: 2, column: 1 }, end: { line: 2, column: 3 } },
        }
      : {}),
  },
});
beforeEach(() => {
  useNativeConfigNoticeStore.setState({ notices: [] });
  reads.mockReset().mockResolvedValue("first\n世界a\nlast");
});
it("retains native threadless warnings in the real notification handler without routing into a current thread", () => {
  const { result } = renderHook(() =>
    useServerNotificationHandler(
      {
        isCodexThreadActiveRef: { current: true },
        taskCompleteBeepModeRef: { current: "never" },
        preventSleepDuringTasksRef: { current: false },
      },
      async () => {},
    ),
  );
  act(() => result.current(warning() as any));
  expect(useNativeConfigNoticeStore.getState().notices).toHaveLength(1);
});
it("keeps exact notice severity/path/range, deduplicates equal notices and retains at most 20", () => {
  observeConfigNotice(warning("One", "/fixture/config.toml"));
  observeConfigNotice(warning("One", "/fixture/config.toml"));
  observeConfigNotice({
    method: "deprecationNotice",
    params: { summary: "Deprecated config", details: null },
  });
  expect(
    useNativeConfigNoticeStore.getState().notices.map((notice) => notice.kind),
  ).toEqual(["configWarning", "deprecation"]);
  expect(useNativeConfigNoticeStore.getState().notices[0]).toMatchObject({
    path: "/fixture/config.toml",
    range: { start: { line: 2, column: 1 }, end: { line: 2, column: 3 } },
  });
  for (let index = 0; index < 30; index++)
    observeConfigNotice(warning(`Warning ${index}`));
  expect(useNativeConfigNoticeStore.getState().notices).toHaveLength(20);
  expect(useNativeConfigNoticeStore.getState().notices[0].summary).toBe(
    "Warning 10",
  );
  observeConfigNotice({ method: "configWarning", params: { summary: 123 } });
  expect(useNativeConfigNoticeStore.getState().notices).toHaveLength(20);
});
it("opens only a captured real path as readonly source with one-based Unicode location, never mutates config", async () => {
  observeConfigNotice(warning("Open original", "/fixture/original.toml"));
  render(<NativeConfigNotices />);
  expect(screen.getByRole("alert").textContent).toContain("Open original");
  expect(
    screen.getByRole("alert").querySelector("svg")?.getAttribute("viewBox"),
  ).toBe("0 0 16 16");
  fireEvent.click(
    screen.getByRole("button", { name: "accountUsage.openFile" }),
  );
  await screen.findByText("世界");
  expect(reads).toHaveBeenCalledWith("/fixture/original.toml", {
    suppressToast: true,
  });
  expect(
    screen.getByRole("dialog").querySelector('[data-config-line="2"] mark')
      ?.textContent,
  ).toBe("世界");
  expect(
    screen
      .getByRole("dialog")
      .querySelector("textarea,input,[contenteditable=true]"),
  ).toBeNull();
});
it("no path or invalid native location does not create a fake open-file action", () => {
  observeConfigNotice(warning());
  observeConfigNotice({
    method: "configWarning",
    params: {
      summary: "unsafe path",
      details: null,
      path: "/fixture\nconfig.toml",
    },
  });
  render(<NativeConfigNotices />);
  expect(
    screen.queryByRole("button", { name: "accountUsage.openFile" }),
  ).toBeNull();
  expect(reads).not.toHaveBeenCalled();
});
