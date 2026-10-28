import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { UserMessageItem } from "./UserMessageItem";
import { revealUserMessageFlash } from "@session/features/thread-workflows/userMessageReveal";

vi.mock("../presentation/nativeFenceHighlight", () => ({
  nativeFenceHighlight: { highlight: () => null },
}));

/**
 * The rail's post-jump flash targets `[data-user-message-bubble]`, the marker the
 * shipped 26.51007.21434 webview puts on its bubble
 * (`user-message-1d0c590c48c7.js`). Without it on our bubble the flash resolves
 * to nothing and the jump lands with no visible cue, so the marker is part of
 * the contract rather than decoration.
 */
const show = (text = "用户消息") =>
  render(
    <div className="session-mode">
      <UserMessageItem
        content={[{ type: "text" as const, text, text_elements: [] }]}
        threadId="owner"
        turnId="turn"
        itemId="item"
      />
    </div>,
  );

it("marks the bubble so the reveal flash can find it", () => {
  const { container } = show();
  const bubble = container.querySelector("[data-user-message-bubble]");
  expect(bubble).not.toBeNull();
  // The marker has to sit on the bubble itself: the flash animates that
  // element's own background, so tagging a wrapper would tint the whole row.
  expect(bubble?.classList.contains("codex-user-bubble")).toBe(true);
});

it("lets the ported flash animate the rendered bubble", () => {
  const { container } = show();
  const bubble = container.querySelector<HTMLElement>(
    "[data-user-message-bubble]",
  )!;
  const animate = vi.fn();
  Object.defineProperty(bubble, "animate", { value: animate });

  revealUserMessageFlash(container.querySelector(".codex-native-user"));

  expect(animate).toHaveBeenCalledTimes(1);
});

/**
 * An inline-edited row renders the editor instead of a bubble, which is the one
 * no-target case that actually occurs in session mode. The flash must skip it
 * rather than tint the editor chrome.
 */
it("leaves an inline-edited row unflashed", () => {
  const { container } = render(
    <div className="session-mode">
      <UserMessageItem
        content={[
          { type: "text" as const, text: "用户消息", text_elements: [] },
        ]}
        threadId="owner"
        turnId="turn"
        itemId="item"
        inlineEditor={<textarea data-testid="editor" defaultValue="用户消息" />}
      />
    </div>,
  );

  expect(container.querySelector("[data-user-message-bubble]")).toBeNull();
  expect(() =>
    revealUserMessageFlash(container.querySelector(".codex-native-user")),
  ).not.toThrow();
});
