import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { EventItem } from "./EventItem";
import { AgentMessageItem } from "./AgentMessageItem";
import { TooltipProvider } from "@session/components/ui/tooltip";
import { useCodexStore } from "../stores/useCodexStore";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { useEditorStore } from "@session/stores/useEditorStore";
import {
  readDraft,
  sessionDraftKey,
} from "@session/stores/useSessionDraftStore";

vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "zh-CN" },
    t: (key: string) => key,
  }),
}));

beforeEach(() => {
  useCodexStore.setState({
    threads: [{ id: "memory-owner", cwd: "/original" } as never],
  });
  useWorkspaceStore.setState({ cwd: "/different", projects: ["/different"] });
  useEditorStore.getState().resetFiles();
});

const entries = [
  {
    path: "/private/one.md",
    lineStart: 2,
    lineEnd: 8,
    note: "Remembered owner isolation",
  },
  {
    path: "/private/two.md",
    lineStart: 3,
    lineEnd: 4,
    note: "<script>unsafe()</script> is literal public note",
  },
  {
    path: "  ",
    lineStart: 1,
    lineEnd: 1,
    note: "blank-path entry must not be shown",
  },
];

function event(memoryCitation: unknown): ServerNotification {
  return {
    method: "item/completed",
    params: {
      threadId: "memory-owner",
      turnId: "memory-turn",
      item: {
        type: "agentMessage",
        id: "memory-item",
        text: "Completed reply",
        phase: "final_answer",
        memoryCitation,
      },
    },
  } as unknown as ServerNotification;
}

it("projects real completed memoryCitation metadata to the native count and safe note tooltip", async () => {
  const draft = readDraft(sessionDraftKey("codex", "memory-owner"));
  const { container } = render(
    <TooltipProvider>
      <EventItem
        event={event({ entries, threadIds: ["hidden-source-thread"] })}
      />
    </TooltipProvider>,
  );
  const button = screen.getByRole("button", { name: "2 条记忆引用" });
  fireEvent.focus(button);
  await waitFor(() =>
    expect(screen.getByRole("tooltip").textContent).toContain("引用的记忆"),
  );
  expect(screen.getByRole("tooltip").textContent).toContain(entries[0].note);
  expect(screen.getByRole("tooltip").textContent).toContain(entries[1].note);
  expect(screen.queryByText(entries[2].note)).toBeNull();
  expect(screen.getByRole("tooltip").querySelector("script")).toBeNull();
  expect(container.textContent).not.toContain("/private/");
  expect(screen.getByRole("tooltip").textContent).not.toContain(
    "hidden-source-thread",
  );
  expect(useEditorStore.getState().openFiles).toEqual([]);
  expect(useWorkspaceStore.getState().cwd).toBe("/different");
  expect(readDraft(sessionDraftKey("codex", "memory-owner"))).toEqual(draft);
});

it("uses the current item snapshot and removes stale memory metadata without reading files", () => {
  const view = render(
    <TooltipProvider>
      <EventItem event={event({ entries: [entries[0]], threadIds: [] })} />
    </TooltipProvider>,
  );
  expect(screen.getByRole("button", { name: "1 条记忆引用" })).toBeTruthy();
  view.rerender(
    <TooltipProvider>
      <EventItem event={event(null)} />
    </TooltipProvider>,
  );
  expect(screen.queryByRole("button", { name: /条记忆引用/ })).toBeNull();
  expect(useEditorStore.getState().openFiles).toEqual([]);
});

it("does not fabricate memory metadata for streaming text or blank paths", () => {
  const view = render(
    <TooltipProvider>
      <AgentMessageItem
        text="Streaming reply"
        threadId="memory-owner"
        streaming
      />
    </TooltipProvider>,
  );
  expect(screen.queryByRole("button", { name: /条记忆引用/ })).toBeNull();
  view.rerender(
    <TooltipProvider>
      <EventItem event={event({ entries: [entries[2]], threadIds: [] })} />
    </TooltipProvider>,
  );
  expect(screen.queryByRole("button", { name: /条记忆引用/ })).toBeNull();
});

it("touch activation keeps public memory notes open until a deliberate second activation", async () => {
  render(
    <div data-testid="transcript-scroll">
      <TooltipProvider>
        <EventItem event={event({ entries: [entries[0]], threadIds: [] })} />
      </TooltipProvider>
    </div>,
  );
  const button = screen.getByRole("button", { name: "1 条记忆引用" });
  const pointerDown = new Event("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(pointerDown, "pointerType", { value: "touch" });
  fireEvent(button, pointerDown);
  fireEvent.pointerUp(button);
  fireEvent.click(button);
  await waitFor(() =>
    expect(screen.getByRole("tooltip").textContent).toContain(entries[0].note),
  );
  // Radix closes ordinary hover tooltips when an ancestor scrolls. A touch tap
  // should remain readable through transcript restoration/resize scrolling.
  fireEvent.scroll(screen.getByTestId("transcript-scroll"));
  expect(screen.getByRole("tooltip").textContent).toContain(entries[0].note);
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("keeps the native desktop tooltip scroll-dismiss behavior", async () => {
  render(
    <div data-testid="transcript-scroll">
      <TooltipProvider>
        <EventItem event={event({ entries: [entries[0]], threadIds: [] })} />
      </TooltipProvider>
    </div>,
  );
  fireEvent.focus(screen.getByRole("button", { name: "1 条记忆引用" }));
  await waitFor(() => expect(screen.getByRole("tooltip")).toBeTruthy());
  fireEvent.scroll(screen.getByTestId("transcript-scroll"));
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});

it("dismisses a touch-open memory popup with Escape and outside activation", async () => {
  render(
    <TooltipProvider>
      <EventItem event={event({ entries: [entries[0]], threadIds: [] })} />
      <button>Outside</button>
    </TooltipProvider>,
  );
  const button = screen.getByRole("button", { name: "1 条记忆引用" });
  const tap = () => {
    const down = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    fireEvent(button, down);
    fireEvent.pointerUp(button);
    fireEvent.click(button);
  };
  tap();
  await waitFor(() => expect(screen.getByRole("tooltip")).toBeTruthy());
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  tap();
  await waitFor(() => expect(screen.getByRole("tooltip")).toBeTruthy());
  fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" }));
  fireEvent.click(screen.getByRole("button", { name: "Outside" }));
  await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
});
