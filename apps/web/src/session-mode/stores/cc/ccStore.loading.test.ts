import { beforeEach, expect, it } from "vitest";
import { useCCStore } from "./ccStore";
beforeEach(() =>
  useCCStore.setState({
    activeSessionId: "a",
    isLoading: true,
    sessionLoadingMap: { a: true },
    messages: [],
    sessionMessagesMap: {},
  }),
);
it("restores the selected session running state when switching away and back", () => {
  useCCStore.getState().switchToSession("b");
  expect(useCCStore.getState().isLoading).toBe(false);
  useCCStore.getState().switchToSession("a");
  expect(useCCStore.getState().isLoading).toBe(true);
});
it("keeps actual task progress after a transient session setup spinner ends", () => {
  useCCStore.setState({ isLoading: false, sessionLoadingMap: {} });
  useCCStore.getState().addMessage({ type: "user", text: "hello" });
  useCCStore.getState().setLoading(false);
  useCCStore.getState().switchToSession("b");
  useCCStore.getState().switchToSession("a");
  expect(useCCStore.getState().isLoading).toBe(true);
});
