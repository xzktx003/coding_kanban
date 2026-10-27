import { render } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentMessageItem } from "./AgentMessageItem";
import { TranscriptInspectionContext } from "../thread/inspection";
const focus = vi.hoisted(() => ({ current: true }));
vi.mock("@session/hooks/useWindowFocus", () => ({
  useWindowFocus: () => focus.current,
}));
vi.mock("../presentation/CodexMarkdown", () => ({
  CodexMarkdown: ({ value }: { value: string }) => <div>{value}</div>,
}));
vi.mock("../composer/v2/MessageReferenceActions", () => ({
  MessageReferenceActions: () => null,
}));
beforeEach(() => {
  focus.current = true;
});
it("makes only the selected latest actions persistent and restores historical hover classes", () => {
  const { container, rerender } = render(
    <AgentMessageItem text="Complete" alwaysShowActions />,
  );
  expect(
    container.querySelector(".session-message-actions")?.className,
  ).not.toMatch(/\binvisible\b/);
  rerender(<AgentMessageItem text="Complete" alwaysShowActions={false} />);
  expect(
    container.querySelector(".session-message-actions")?.className,
  ).toContain("group-hover:visible");
  expect(
    container.querySelector(".session-message-actions")?.className,
  ).toMatch(/\binvisible\b/);
});
it("preserves streaming, inspection and unfocused boundaries", () => {
  const { container, rerender } = render(
    <AgentMessageItem text="Partial" streaming alwaysShowActions />,
  );
  expect(container.querySelector(".session-message-actions")).toBeNull();
  rerender(
    <TranscriptInspectionContext.Provider value>
      <AgentMessageItem text="Complete" alwaysShowActions />
    </TranscriptInspectionContext.Provider>,
  );
  expect(
    container.querySelector(".session-message-actions")?.className,
  ).toMatch(/\binvisible\b/);
  focus.current = false;
  rerender(<AgentMessageItem text="Complete" alwaysShowActions />);
  expect(
    container.querySelector(".session-message-actions")?.className,
  ).toMatch(/\binvisible\b/);
  expect(
    container.querySelector(".session-message-actions")?.className,
  ).not.toContain("group-hover:visible");
});
