import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  hydrateThreadModel,
  changeThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import {
  ModelChangeNotice,
  commitModelSelectionWithNotice,
} from "./ModelChangeNotice";
import { NativeNotificationViewport } from "@session/features/native-notifications/NativeNotificationViewport";
import { nativeNotifications } from "@session/features/native-notifications/service";
import { useCodexStore } from "../stores/useCodexStore";
beforeEach(() => {
  useCodexStore.setState({
    events: {
      a: [
        {
          method: "item/started",
          params: {
            threadId: "a",
            turnId: "turn-1",
            startedAtMs: 1,
            item: {
              type: "agentMessage",
              id: "message",
              text: "fixture",
              phase: null,
              memoryCitation: null,
            },
          },
        },
      ],
    },
  });
  useThreadModelStore.setState({ threads: {} });
});
afterEach(() => nativeNotifications.closeAll());
it("shows one v2 warning in the native notification card and closes without modifying either model", async () => {
  for (const id of ["a", "b"]) hydrateThreadModel(id, { model: "base" });
  const view = render(
    <>
      <NativeNotificationViewport />
      <ModelChangeNotice threadId="a" />
    </>,
  );
  act(() =>
    commitModelSelectionWithNotice("a", "recent", () =>
      changeThreadModel("a", { model: "next" }),
    ),
  );
  const warning = await screen.findByText(
    "在对话中途更改模型会降低性能。为获得最佳体验，请开始新会话，或切换回 base。",
  );
  expect(warning.closest(".codex-native-alert")).toBeTruthy();
  expect(
    view.container.querySelector(".session-model-change-notice"),
  ).toBeNull();
  expect(warning.textContent?.match(/降低性能/g)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /关闭|Close/ }));
  await waitFor(() =>
    expect(screen.queryByText(warning.textContent!)).toBeNull(),
  );
  expect(useThreadModelStore.getState().threads.a.model).toBe("next");
  expect(useThreadModelStore.getState().threads.b.model).toBe("base");
});
