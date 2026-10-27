import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const notifications = vi.hoisted(() => ({
  info: vi.fn(() => ({ close: vi.fn() })),
}));
vi.mock("@session/features/native-notifications/service", () => ({
  nativeNotifications: notifications,
}));
import { useLayoutStore } from "@session/stores/useLayoutStore";
import {
  ModelChangeNotice,
  commitModelSelectionWithNotice,
} from "./ModelChangeNotice";
import {
  changeThreadModel,
  hydrateThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";

import { useCodexStore } from "../stores/useCodexStore";
function select(
  threadId: string,
  model: string,
  source: "power" | "recent" = "recent",
) {
  commitModelSelectionWithNotice(threadId, source, () =>
    changeThreadModel(threadId, { model }),
  );
}
function history(threadId = "a", turnId = "turn-1") {
  useCodexStore.setState((state) => ({
    turnTimingMap: {
      ...state.turnTimingMap,
      [threadId]: {
        turnId,
        status: "completed",
        startedAtMs: 1,
        durationMs: 1,
      },
    },
    events: {
      ...state.events,
      [threadId]: [
        {
          method: "turn/completed",
          params: {
            threadId,
            turn: {
              id: turnId,
              items: [],
              itemsView: "full",
              status: "completed",
              error: null,
              startedAt: 1,
              completedAt: 2,
              durationMs: 1000,
            },
          },
        },
      ],
    },
  }));
}
beforeEach(() => {
  useCodexStore.setState({ events: {}, turnTimingMap: {} });
  history();
  history("b");
  notifications.info.mockClear();
  useLayoutStore.setState({ view: "agent" });
  useThreadModelStore.setState({ threads: {} });
  hydrateThreadModel("a", { model: "base" });
  hydrateThreadModel("b", { model: "other" });
});
afterEach(cleanup);
it("emits the warning through the native toast viewport without a rail or transcript divider", () => {
  const view = render(<ModelChangeNotice threadId="a" />);
  act(() => select("a", "next"));
  expect(notifications.info).toHaveBeenCalledWith(
    "在对话中途更改模型会降低性能。为获得最佳体验，请开始新会话，或切换回 base。",
    expect.objectContaining({
      id: "composer.modelChangeDuringConversationWarning.a",
    }),
  );
  expect(view.container.textContent).toBe("");
  expect(view.container.querySelector('[role="status"]')).toBeNull();
});
it("consumes a stable notice once across duplicate surfaces, thread switching, and remounting", () => {
  const first = render(<ModelChangeNotice threadId="a" />);
  const second = render(<ModelChangeNotice threadId="a" />);
  act(() => select("a", "next"));
  expect(notifications.info).toHaveBeenCalledTimes(1);
  first.rerender(<ModelChangeNotice threadId="b" />);
  first.rerender(<ModelChangeNotice threadId="a" />);
  second.unmount();
  render(<ModelChangeNotice threadId="a" />);
  expect(notifications.info).toHaveBeenCalledTimes(1);
  act(() => select("a", "third"));
  expect(notifications.info).toHaveBeenCalledTimes(2);
});
it("does not replay persisted notices or announce read-only native restoration", () => {
  changeThreadModel("a", { model: "next" });
  hydrateThreadModel("a", { model: "next" });
  const view = render(<ModelChangeNotice threadId="a" />);
  act(() => hydrateThreadModel("a", { model: "restored" }, { notify: true }));
  expect(notifications.info).not.toHaveBeenCalled();
  expect(view.container.textContent).toBe("");
});
it("does not announce changes received while session mode is hidden or replay them on return", () => {
  const view = render(
    <div className="session-mode" hidden>
      <ModelChangeNotice threadId="a" />
    </div>,
  );
  act(() => select("a", "next"));
  view.rerender(
    <div className="session-mode">
      <ModelChangeNotice threadId="a" />
    </div>,
  );
  expect(notifications.info).not.toHaveBeenCalled();
  act(() => select("a", "third"));
  expect(notifications.info).toHaveBeenCalledTimes(1);
});
it("captures the selected thread without consuming another thread's notice", () => {
  render(<ModelChangeNotice threadId="a" />);
  act(() => select("b", "next"));
  expect(notifications.info).not.toHaveBeenCalled();
  expect(useThreadModelStore.getState().threads.b.notice?.dismissed).toBe(
    false,
  );
  act(() => select("a", "next"));
  expect(notifications.info).toHaveBeenCalledTimes(1);
  expect(useThreadModelStore.getState().threads.b.notice?.dismissed).toBe(
    false,
  );
});
it("uses the shared Agent visibility contract on secondary pages and inherited inert roots", () => {
  const view = render(
    <div inert>
      <div className="session-mode">
        <ModelChangeNotice threadId="a" />
      </div>
    </div>,
  );
  act(() => select("a", "next"));
  expect(notifications.info).not.toHaveBeenCalled();
  view.rerender(
    <div>
      <div className="session-mode">
        <ModelChangeNotice threadId="a" />
      </div>
    </div>,
  );
  act(() => useLayoutStore.setState({ view: "settings" }));
  act(() => select("a", "third"));
  expect(notifications.info).not.toHaveBeenCalled();
  act(() => useLayoutStore.setState({ view: "agent" }));
  expect(notifications.info).not.toHaveBeenCalled();
  act(() => select("a", "fourth"));
  expect(notifications.info).toHaveBeenCalledTimes(1);
});

it("does not convert ordinary store writes or read-only state changes into an operation notice", () => {
  render(<ModelChangeNotice threadId="a" />);
  act(() => changeThreadModel("a", { model: "next" }));
  expect(notifications.info).not.toHaveBeenCalled();
});
it("deduplicates power warnings by actual latest turn while recent selection is independent", () => {
  render(<ModelChangeNotice threadId="a" />);
  act(() => select("a", "first", "power"));
  act(() => select("a", "second", "power"));
  expect(notifications.info).toHaveBeenCalledTimes(1);
  act(() => select("a", "third", "recent"));
  expect(notifications.info).toHaveBeenCalledTimes(2);
  act(() => history("a", "turn-2"));
  act(() => select("a", "fourth", "power"));
  expect(notifications.info).toHaveBeenCalledTimes(3);
});
it("requires observed history for both paths and latest turn metadata for power only", () => {
  render(<ModelChangeNotice threadId="a" />);
  useCodexStore.setState({ events: {}, turnTimingMap: {} });
  act(() => select("a", "first", "power"));
  act(() => select("a", "second", "recent"));
  expect(notifications.info).not.toHaveBeenCalled();
  history();
  useCodexStore.setState({ turnTimingMap: {} });
  act(() => select("a", "third", "power"));
  expect(notifications.info).not.toHaveBeenCalled();
  act(() => select("a", "fourth", "recent"));
  expect(notifications.info).toHaveBeenCalledTimes(1);
});
it("does not manufacture an operation when a setter is rejected, native restoration runs, or another thread changes", () => {
  render(<ModelChangeNotice threadId="a" />);
  act(() => commitModelSelectionWithNotice("a", "power", () => {}));
  act(() =>
    commitModelSelectionWithNotice("a", "power", () =>
      hydrateThreadModel("a", { model: "next" }),
    ),
  );
  act(() =>
    commitModelSelectionWithNotice("a", "power", () =>
      changeThreadModel("b", { model: "next" }),
    ),
  );
  expect(notifications.info).not.toHaveBeenCalled();
});
it("shares an operation claim without allowing a duplicate surface to warn again in the same turn", () => {
  render(
    <>
      <ModelChangeNotice threadId="a" />
      <ModelChangeNotice threadId="a" />
    </>,
  );
  act(() => select("a", "first", "power"));
  act(() => select("a", "second", "power"));
  expect(notifications.info).toHaveBeenCalledTimes(1);
});
