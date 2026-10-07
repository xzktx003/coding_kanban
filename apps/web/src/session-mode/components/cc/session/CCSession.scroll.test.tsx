import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../hooks", () => ({
  useCCSessionListener: () => {},
  useCCPermissionListener: () => {},
}));
vi.mock("@session/hooks/useSessionReadReceipt", () => ({
  useSessionReadReceipt: () => {},
}));
vi.mock("./messages", () => ({ CCMessage: () => <div>message</div> }));
vi.mock("./messages/group", () => ({
  buildMessageGroups: () => [],
  CCExploredMessageGroup: () => null,
}));
vi.mock("./messages/inlineErrors", () => ({
  buildInlineErrorsMap: () => ({}),
}));
import CCSession from "./CCSession";
import { useCCStore } from "@session/stores/cc";
const scroll = vi.fn();
beforeEach(() => {
  scroll.mockReset();
  HTMLElement.prototype.scrollTo = scroll;
  useCCStore.setState({
    sessionMessagesMap: { a: [], b: [] },
    sessionLoadingMap: {},
  });
});
it("switching sessions resets history reading and jumps immediately to latest, including later history loading", () => {
  const view = render(<CCSession sessionId="a" disableListener />);
  const history = view.container.querySelector(".overflow-y-auto")!;
  Object.defineProperties(history, {
    scrollHeight: { configurable: true, value: 3000 },
    clientHeight: { configurable: true, value: 400 },
    scrollTop: { configurable: true, writable: true, value: 100 },
  });
  fireEvent.scroll(history);
  scroll.mockClear();
  view.rerender(<CCSession sessionId="b" disableListener />);
  expect(scroll).toHaveBeenCalledWith({ top: 3000, behavior: "auto" });
  scroll.mockClear();
  act(() =>
    useCCStore.setState({
      sessionMessagesMap: {
        a: [],
        b: [{ type: "user", text: "loaded history" }],
      },
    }),
  );
  expect(scroll).toHaveBeenCalledWith({ top: 3000, behavior: "auto" });
});
