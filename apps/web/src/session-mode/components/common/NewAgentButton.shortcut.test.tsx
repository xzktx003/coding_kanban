import { fireEvent, render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { NewAgentButton } from "./NewAgentButton";
import { useLayoutStore } from "@session/stores";
const actions = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@session/components/codex/hooks", () => ({
  useNewThread: () => ({ handleNewThread: actions.create }),
}));
vi.mock("@session/hooks/useCCSessionManager", () => ({
  useCCSessionManager: () => ({ handleNewSession: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
beforeEach(() => {
  actions.create.mockClear();
  useLayoutStore.setState({ view: "agent" });
});
test("multiple visible new buttons execute one keyboard action", () => {
  render(
    <div className="session-mode">
      <NewAgentButton />
      <NewAgentButton />
    </div>,
  );
  fireEvent.keyDown(window, { key: "n", ctrlKey: true });
  expect(actions.create).toHaveBeenCalledTimes(1);
});
test("new shortcut does not interrupt dialog input", () => {
  const { getByRole } = render(
    <div className="session-mode">
      <NewAgentButton />
      <div role="dialog">
        <input aria-label="会话名称" />
      </div>
    </div>,
  );
  fireEvent.keyDown(getByRole("textbox"), { key: "n", ctrlKey: true });
  expect(actions.create).not.toHaveBeenCalled();
});
