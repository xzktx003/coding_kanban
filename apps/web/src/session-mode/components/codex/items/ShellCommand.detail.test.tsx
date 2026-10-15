import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const commandStyles = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../codex-presentation.css",
  ),
  "utf8",
);
import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { zh } from "@session/locales/zh";
import { usePairingStore } from "@session/stores/usePairingStore";
import { openEventStream } from "@session/lib/eventStream";
import { TranscriptDetailVisibility } from "../hooks/transcriptDetailVisibility";
import { ShellCommand } from "./ShellCommand";
import { CommandActionSummaryItem } from "./CommandActionSummaryItem";
import { NativeActivityGroup } from "./NativeActivityGroup";
import { buildThreadRows } from "../thread/threadRows";
import { groupThreadActivities } from "../thread/activityRows";
import { RowStateContext } from "../thread/rowState";

vi.mock("@session/lib/eventStream", () => ({
  openEventStream: vi.fn(() => () => {}),
}));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
const props = {
  command: "projected short command",
  commandItemId: "item",
  threadId: "thread",
  turnId: "turn",
  status: "completed" as const,
  transcriptMetadataOnly: true,
};
const item = {
  type: "commandExecution",
  id: "item",
  command: 'printf "full command"',
  cwd: "/owned",
  status: "completed",
  aggregatedOutput: "\x1b[31mFULL_OUTPUT\x1b[0m",
  exitCode: 0,
  durationMs: 12,
};
const envelope = (value: any = item) => ({
  threadId: "thread",
  turnId: "turn",
  itemId: "item",
  item: value,
});
let request: ReturnType<typeof vi.fn>;
beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "zh",
    resources: { zh: { thread: zh.thread } },
    interpolation: { escapeValue: false },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  usePairingStore.setState({ selectedHost: null, desktops: [] });
});
beforeEach(() => {
  vi.mocked(openEventStream).mockClear();
  request = vi.fn(
    async () => new Response(JSON.stringify(envelope()), { status: 200 }),
  );
  vi.stubGlobal("fetch", request);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => {}) },
  });
});
const open = (container: HTMLElement) =>
  fireEvent.click(container.querySelector(".codex-command-summary")!);
it("loads actual metadata only on explicit command activation and copies complete native command/output", async () => {
  const view = render(<ShellCommand {...props} />);
  expect(request).not.toHaveBeenCalled();
  open(view.container);
  await screen.findByText("FULL_OUTPUT");
  expect(request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({
    threadId: "thread",
    turnId: "turn",
    itemId: "item",
    expectedType: "commandExecution",
  });
  expect(
    view.container.querySelector(".codex-command-output span")?.className,
  ).toContain("ansi-red");
  fireEvent.click(screen.getByRole("button", { name: "复制命令" }));
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
    'printf "full command"',
  );
  fireEvent.click(screen.getByRole("button", { name: "复制输出" }));
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(
    item.aggregatedOutput,
  );
  open(view.container);
  expect(view.container.textContent).not.toContain("FULL_OUTPUT");
  open(view.container);
  await screen.findByText("FULL_OUTPUT");
  expect(request).toHaveBeenCalledTimes(2);
});
it("coalesces two actual rows and detaches one independently; distinct target is busy until manual retry", async () => {
  let resolve!: (v: Response) => void;
  request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  const a = render(<ShellCommand {...props} />),
    b = render(<ShellCommand {...props} />),
    c = render(<ShellCommand {...props} commandItemId="other" />);
  open(a.container);
  open(b.container);
  open(c.container);
  expect(request).toHaveBeenCalledTimes(1);
  expect(c.container.textContent).toContain("其他详情正在读取");
  open(a.container);
  expect(request.mock.calls[0][1].signal.aborted).toBe(false);
  await act(async () => resolve(new Response(JSON.stringify(envelope()))));
  await waitFor(() => expect(b.container.textContent).toContain("FULL_OUTPUT"));
  expect(a.container.textContent).not.toContain("FULL_OUTPUT");
  expect(request).toHaveBeenCalledTimes(1);
  request.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify({
          ...envelope({ ...item, id: "other" }),
          itemId: "other",
        }),
      ),
  );
  fireEvent.click(c.container.querySelector("[data-command-detail-load]")!);
  await waitFor(() => expect(c.container.textContent).toContain("FULL_OUTPUT"));
  expect(request).toHaveBeenCalledTimes(2);
});
it.each(["close", "unmount", "target", "runtime", "hidden"] as const)(
  "drops late complete response after %s and never auto-loads",
  async (change) => {
    let resolve!: (v: Response) => void;
    request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const view = render(<ShellCommand {...props} />);
    open(view.container);
    if (change === "close") open(view.container);
    if (change === "unmount") view.unmount();
    if (change === "target")
      view.rerender(<ShellCommand {...props} turnId="new" />);
    if (change === "runtime")
      act(() => window.dispatchEvent(new Event("session-runtime-restarted")));
    if (change === "hidden")
      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => resolve(new Response(JSON.stringify(envelope()))));
    expect(view.container.textContent).not.toContain("FULL_OUTPUT");
    if (change === "hidden")
      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    expect(request).toHaveBeenCalledTimes(1);
  },
);
it.each([
  {},
  { ...envelope(), threadId: "wrong" },
  envelope({ ...item, id: "wrong" }),
  envelope({ ...item, type: "fileChange" }),
  envelope({ ...item, aggregatedOutput: 123 }),
  envelope({ ...item, command: {} }),
])("rejects malformed/mismatched native envelopes %#", async (value) => {
  request.mockImplementationOnce(
    async () => new Response(JSON.stringify(value)),
  );
  const view = render(<ShellCommand {...props} />);
  open(view.container);
  await waitFor(() =>
    expect(view.container.textContent).toContain("详情读取未完成"),
  );
  expect(view.container.textContent).not.toContain("FULL_OUTPUT");
});
it("fails closed on missing legacy native identity", async () => {
  const view = render(<ShellCommand {...props} commandItemId="" />);
  open(view.container);
  expect(request).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain("缺少原生项身份");
});
it("restores cached presentation with unloaded shell and requires explicit load", async () => {
  const cache = new Map<string, unknown>();
  const tree = () => (
    <RowStateContext.Provider value={cache}>
      <ShellCommand {...props} />
    </RowStateContext.Provider>
  );
  const view = render(tree());
  open(view.container);
  await screen.findByText("FULL_OUTPUT");
  view.unmount();
  const again = render(tree());
  expect(again.container.querySelector("[aria-expanded=true]")).toBeTruthy();
  expect(again.container.textContent).not.toContain("FULL_OUTPUT");
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(again.container.querySelector("[data-command-detail-load]")!);
  await screen.findByText("FULL_OUTPUT");
  expect(request).toHaveBeenCalledTimes(2);
});
it("uses both actual caller routes; group opening alone never loads", async () => {
  const events: any = [
    {
      method: "item/completed",
      params: {
        threadId: "thread",
        turnId: "turn",
        item: {
          ...item,
          commandActions: [{ type: "unknown", command: props.command }],
          aggregatedOutput: null,
          transcriptMetadataOnly: true,
        },
      },
    },
    {
      method: "turn/completed",
      params: {
        threadId: "thread",
        turn: { id: "turn", status: "completed", items: [], error: null },
      },
    },
  ];
  events.splice(1, 0, {
    ...events[0],
    params: {
      ...events[0].params,
      item: { ...events[0].params.item, id: "second" },
    },
  });
  const group = groupThreadActivities(buildThreadRows(events), events).find(
    (row) => row.activity,
  )!.activity!;
  const native = render(<NativeActivityGroup group={group} />);
  const summary = render(
    <CommandActionSummaryItem
      actions={[{ type: "unknown", command: props.command }]}
      actionSources={[{ ...props, aggregatedOutput: null }]}
      completed
    />,
  );
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(
    native.container.querySelector(".codex-native-activity-disclosure")!,
  );
  if (
    !native.container.querySelector("[data-command-id] [aria-expanded=true]")
  ) {
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(
      native.container.querySelector(
        "[data-command-id] .codex-command-summary",
      )!,
    );
  }
  await waitFor(() =>
    expect(native.container.textContent).toContain("FULL_OUTPUT"),
  );
  open(summary.container);
  await waitFor(() =>
    expect(summary.container.textContent).toContain("FULL_OUTPUT"),
  );
  expect(request).toHaveBeenCalledTimes(2);
});

it.each([
  "thread",
  "item",
  "token",
  "port",
  "host",
  "disconnect",
  "resync",
  "visibility",
] as const)("fences pending result after %s change", async (change) => {
  let resolve!: (v: Response) => void;
  request.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  const tree = (visible = true) => (
    <TranscriptDetailVisibility.Provider value={visible}>
      <ShellCommand {...props} />
    </TranscriptDetailVisibility.Provider>
  );
  if (["token", "port", "host"].includes(change))
    usePairingStore.setState({
      selectedHost: "owned",
      desktops: [
        {
          host: "owned",
          port: 1234,
          token: "synthetic-test-only",
          name: "fixture",
        },
      ],
    });
  const view = render(tree());
  open(view.container);
  if (change === "thread")
    view.rerender(<ShellCommand {...props} threadId="new" />);
  if (change === "item")
    view.rerender(<ShellCommand {...props} commandItemId="new" />);
  if (["token", "port", "host"].includes(change))
    act(() =>
      usePairingStore.setState({
        selectedHost: change === "host" ? "other" : "owned",
        desktops: [
          {
            host: "owned",
            port: change === "port" ? 2345 : 1234,
            token:
              change === "token" ? "new-synthetic-only" : "synthetic-test-only",
            name: "fixture",
          },
        ],
      }),
    );
  const subscriber = vi.mocked(openEventStream).mock.calls.at(-1)![0];
  if (change === "disconnect")
    act(() =>
      subscriber.onEvent({ seq: 1, event: "codex:disconnected", payload: {} }),
    );
  if (change === "resync") act(() => subscriber.onResync?.());
  if (change === "visibility") view.rerender(tree(false));
  expect(request.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => resolve(new Response(JSON.stringify(envelope()))));
  expect(view.container.textContent).not.toContain("FULL_OUTPUT");
  if (change === "visibility") {
    view.rerender(tree());
    expect(view.container.textContent).toContain("详情未载入");
  }
  expect(request).toHaveBeenCalledTimes(1);
});
it("keeps normal stream opening and unrelated pairing rename from revoking the snapshot", async () => {
  const view = render(<ShellCommand {...props} />);
  open(view.container);
  await screen.findByText("FULL_OUTPUT");
  const subscriber = vi.mocked(openEventStream).mock.calls.at(-1)![0];
  act(() => subscriber.onOpen?.());
  act(() =>
    usePairingStore.getState().addDesktop({
      host: "unselected",
      port: 1234,
      token: "synthetic",
      name: "other",
    }),
  );
  // Adding the first selected desktop is a real target change; simple unselected edits below are not.
  expect(view.container.textContent).not.toContain("FULL_OUTPUT");
});
it("clears completed native body on observed disconnect and tears down shared listener after last owner leaves", async () => {
  const stop = vi.fn();
  vi.mocked(openEventStream).mockImplementationOnce(() => stop);
  const a = render(<ShellCommand {...props} />);
  open(a.container);
  await screen.findByText("FULL_OUTPUT");
  act(() =>
    vi
      .mocked(openEventStream)
      .mock.calls.at(-1)![0]
      .onEvent({ seq: 1, event: "codex:disconnected", payload: {} }),
  );
  expect(a.container.textContent).not.toContain("FULL_OUTPUT");
  expect(stop).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
});
it("does not accept a partial JSON success body or auto-retry transport/server errors", async () => {
  request.mockImplementationOnce(
    async () => new Response('{"threadId":"thread","item":'),
  );
  const view = render(<ShellCommand {...props} />);
  open(view.container);
  await waitFor(() =>
    expect(view.container.textContent).toContain("详情读取未完成"),
  );
  expect(request).toHaveBeenCalledTimes(1);
  request.mockImplementationOnce(
    async () => new Response("{}", { status: 429 }),
  );
  fireEvent.click(view.container.querySelector("[data-command-detail-load]")!);
  await waitFor(() =>
    expect(view.container.textContent).toContain("其他详情正在读取"),
  );
  expect(request).toHaveBeenCalledTimes(2);
});
it("copies every byte of multi MiB native ANSI output while keeping chat metadata and row cache body free", async () => {
  const raw = "\x1b[31m" + "selected 😀".repeat(220000) + "\x1b[0m";
  request.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify(envelope({ ...item, aggregatedOutput: raw })),
      ),
  );
  const cache = new Map<string, unknown>();
  const view = render(
    <RowStateContext.Provider value={cache}>
      <ShellCommand {...props} />
    </RowStateContext.Provider>,
  );
  open(view.container);
  await waitFor(() =>
    expect(
      view.container.querySelector(".codex-command-output-content code")
        ?.textContent?.length,
    ).toBe("selected 😀".length * 220000),
  );
  fireEvent.click(screen.getByRole("button", { name: "复制输出" }));
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(raw);
  expect(JSON.stringify([...cache])).not.toContain("selected");
  open(view.container);
  expect(view.container.querySelector(".ansi-red-fg")).toBeNull();
  expect(view.container.querySelector('[title="复制输出"]')).toBeNull();
});

it("starts one selected read for one explicit activation under React StrictMode", async () => {
  const view = render(
    <StrictMode>
      <ShellCommand {...props} />
    </StrictMode>,
  );
  expect(request).not.toHaveBeenCalled();
  open(view.container);
  await screen.findByText("FULL_OUTPUT");
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1].signal.aborted).toBe(false);
});
it("keeps native missing-output and in-progress snapshot truthful while chat status stays authoritative", async () => {
  request.mockImplementationOnce(
    async () =>
      new Response(
        JSON.stringify(
          envelope({
            ...item,
            status: "inProgress",
            aggregatedOutput: null,
            exitCode: null,
            durationMs: null,
          }),
        ),
      ),
  );
  const view = render(<ShellCommand {...props} />);
  open(view.container);
  await screen.findByText("原生快照未保存输出");
  expect(view.container.textContent).toContain("本次快照仍在运行");
  expect(view.container.textContent).not.toContain("命令成功");
  expect(
    view.container
      .querySelector("[data-command-status]")
      ?.getAttribute("data-command-status"),
  ).toBe("completed");
});

it("refuses C1 native identity before any request", () => {
  const view = render(<ShellCommand {...props} commandItemId={"item\u0085"} />);
  open(view.container);
  expect(request).not.toHaveBeenCalled();
  expect(view.container.textContent).toContain("缺少原生项身份");
});
it("includes source terminal color rules confined to command detail", () => {
  expect(commandStyles).toMatch(
    /\.session-mode \.codex-command \.ansi-red-fg\s*\{[^}]*--vscode-terminal-ansiRed[^}]*#f66/s,
  );
  expect(commandStyles).toMatch(
    /\.session-mode \.codex-command \.ansi-bright-cyan-fg\s*\{[^}]*--vscode-terminal-ansiBrightCyan[^}]*#adffff/s,
  );
});
it("keeps summaries free of unloaded badges before and after detail release", async () => {
  const view = render(<ShellCommand {...props} />);
  expect(
    view.container.querySelector("[data-transcript-details-unloaded]"),
  ).toBeNull();
  open(view.container);
  await screen.findByText("FULL_OUTPUT");
  expect(
    view.container.querySelector("[data-transcript-details-unloaded]"),
  ).toBeNull();
  open(view.container);
  expect(
    view.container.querySelector("[data-transcript-details-unloaded]"),
  ).toBeNull();
});
it.each(["native", "legacy"] as const)(
  "coalesces two explicit %s caller rows from one original native item",
  async (route) => {
    let resolveResponse!: (v: Response) => void;
    request.mockImplementationOnce(
      () => new Promise((r) => (resolveResponse = r)),
    );
    const actions: any = [
      { type: "unknown", command: "first projected action" },
      { type: "unknown", command: "second projected action" },
    ];
    const events: any = [
      {
        method: "item/completed",
        params: {
          threadId: "thread",
          turnId: "turn",
          item: {
            ...item,
            commandActions: actions,
            aggregatedOutput: null,
            transcriptMetadataOnly: true,
          },
        },
      },
      {
        method: "turn/completed",
        params: {
          threadId: "thread",
          turn: { id: "turn", status: "completed", items: [], error: null },
        },
      },
    ];
    const group = groupThreadActivities(buildThreadRows(events), events).find(
      (row) => row.activity,
    )!.activity!;
    const view = render(
      route === "native" ? (
        <NativeActivityGroup group={group} />
      ) : (
        <CommandActionSummaryItem
          actions={actions}
          actionSources={actions.map(() => ({
            ...props,
            aggregatedOutput: null,
          }))}
          completed
        />
      ),
    );
    fireEvent.click(
      view.container.querySelector(
        route === "native"
          ? ".codex-native-activity-disclosure"
          : ".codex-activity-header",
      )!,
    );
    expect(request).not.toHaveBeenCalled();
    const buttons = view.container.querySelectorAll(
      '[data-command-id="item"] .codex-command-summary',
    );
    expect(buttons.length).toBe(2);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[0]);
    expect(request.mock.calls[0][1].signal.aborted).toBe(false);
    await act(async () =>
      resolveResponse(new Response(JSON.stringify(envelope()))),
    );
    const rows = view.container.querySelectorAll('[data-command-id="item"]');
    expect(rows[0].textContent).not.toContain("FULL_OUTPUT");
    expect(rows[1].textContent).toContain("FULL_OUTPUT");
    expect(request).toHaveBeenCalledTimes(1);
  },
);
