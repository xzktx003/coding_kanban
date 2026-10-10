import { describe, expect, it } from "vitest";
import { isTranscriptScrollKey } from "./transcriptScrollKeys";
function intent(element: HTMLElement, init: KeyboardEventInit) {
  let accepted: boolean | undefined;
  element.addEventListener(
    "keydown",
    (event) => {
      accepted = isTranscriptScrollKey(event);
    },
    { once: true },
  );
  element.dispatchEvent(new KeyboardEvent("keydown", init));
  return accepted;
}
describe("transcript keyboard scroll ownership", () => {
  it("retains native viewport navigation", () => {
    expect(intent(document.createElement("div"), { key: "ArrowUp" })).toBe(
      true,
    );
    expect(intent(document.createElement("div"), { key: "Home" })).toBe(true);
    expect(intent(document.createElement("div"), { key: "a" })).toBe(false);
  });
  it("leaves textarea/input and nested authored inline editing navigation with the editor", () => {
    expect(intent(document.createElement("textarea"), { key: "ArrowUp" })).toBe(
      false,
    );
    expect(intent(document.createElement("input"), { key: "Home" })).toBe(
      false,
    );
    const editor = document.createElement("div"),
      child = document.createElement("span");
    editor.setAttribute("contenteditable", "plaintext-only");
    editor.append(child);
    expect(intent(child, { key: "Home" })).toBe(false);
  });
  it("does not take keys already consumed by another control", () => {
    const event = new KeyboardEvent("keydown", {
      key: "Home",
      cancelable: true,
    });
    event.preventDefault();
    expect(isTranscriptScrollKey(event)).toBe(false);
  });
  it("does not interpret IME navigation as conversation scrolling", () => {
    expect(
      intent(document.createElement("div"), {
        key: "ArrowUp",
        isComposing: true,
      }),
    ).toBe(false);
    expect(
      intent(document.createElement("div"), { key: "Home", keyCode: 229 }),
    ).toBe(false);
  });
});
