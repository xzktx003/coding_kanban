import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TurnWork } from "./turnWork";
import { TurnWorkHeader } from "./TurnWorkHeader";

vi.mock("@session/session-dom", () => ({
  useAgentInteractionVisible: () => true,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh-CN" },
    t: (key: string, values?: { time: string }) =>
      ({
        workingFor: `已处理 ${values?.time}`,
        workedFor: `用时 ${values?.time}`,
        workActivity: "工作过程",
        waitingForOutput: "暂未显示本轮过程或回复",
      })[key],
  }),
}));

afterEach(() => vi.useRealTimers());

const running: TurnWork = {
  key: "work",
  threadId: "thread",
  turnId: "turn",
  running: true,
  startedAtMs: 1_000_000,
  durationMs: null,
  processKeys: new Set(),
  expanded: false,
};

it("explains prolonged silence, without declaring a failure or resending", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  const { rerender } = render(
    <TurnWorkHeader work={running} onToggle={() => {}} />,
  );
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  act(() => vi.advanceTimersByTime(30_000));
  expect(screen.getByText("暂未显示本轮过程或回复")).toBeTruthy();
  rerender(
    <TurnWorkHeader work={running} onToggle={() => {}} hasLiveMessage />,
  );
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  for (const startedAtMs of [-1, Number.NaN]) {
    rerender(
      <TurnWorkHeader
        work={{ ...running, startedAtMs }}
        onToggle={() => {}}
      />,
    );
    expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  }
  rerender(
    <TurnWorkHeader
      work={{ ...running, processKeys: new Set(["activity"]) }}
      onToggle={() => {}}
    />,
  );
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  rerender(
    <TurnWorkHeader
      work={running}
      onToggle={() => {}}
      retryNotice="原生连接正在重试"
    />,
  );
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  expect(screen.getByText(/原生连接正在重试/)).toBeTruthy();
  rerender(
    <TurnWorkHeader
      work={{ ...running, startedAtMs: null, durationMs: 30_000 }}
      onToggle={() => {}}
    />,
  );
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
  rerender(
    <TurnWorkHeader
      work={{ ...running, running: false, durationMs: 30_000 }}
      onToggle={() => {}}
    />,
  );
  expect(screen.queryByText("暂未显示本轮过程或回复")).toBeNull();
});
