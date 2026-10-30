import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useCodexStore } from "../stores/useCodexStore";
import { CodexThread } from "./CodexThread";

vi.mock("./CodexTranscript", () => new Promise(() => {}));
vi.mock("../hooks/useTranscriptVisibility", () => ({
  useTranscriptVisibility: () => ({
    ref: () => {},
    renderTranscript: true,
    visible: true,
  }),
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: () => () => {},
}));

it("keeps the actual conversation readable and the sibling composer usable while rich rendering loads", () => {
  useCodexStore.setState({
    currentThreadId: "other",
    events: {
      owner: [
        {
          method: "item/completed",
          params: {
            threadId: "owner",
            turnId: "turn",
            item: {
              type: "agentMessage",
              id: "answer",
              text: "The captured owner's cached answer",
              phase: "final_answer",
              memoryCitation: null,
            },
          },
        },
      ],
      other: [
        {
          method: "item/completed",
          params: {
            threadId: "other",
            turnId: "turn2",
            item: {
              type: "agentMessage",
              id: "answer2",
              text: "Another target's answer",
              phase: "final_answer",
              memoryCitation: null,
            },
          },
        },
      ],
    },
  } as never);
  render(
    <>
      <CodexThread threadId="owner" />
      <textarea aria-label="composer" />
    </>,
  );
  expect(screen.getByText("The captured owner's cached answer")).toBeTruthy();
  expect(screen.queryByText("Another target's answer")).toBeNull();
  expect(
    document.querySelector('[data-transcript-preparing="owner"]'),
  ).toBeTruthy();
  const composer = screen.getByRole("textbox", { name: "composer" });
  fireEvent.change(composer, { target: { value: "a saved draft" } });
  expect((composer as HTMLTextAreaElement).value).toBe("a saved draft");
});
