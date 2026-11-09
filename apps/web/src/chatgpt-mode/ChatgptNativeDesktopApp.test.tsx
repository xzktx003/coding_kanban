import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ChatgptNativeDesktopApp from "./ChatgptNativeDesktopApp";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not connect the desktop before the fourth mode is first opened", () => {
  render(<ChatgptNativeDesktopApp active={false} onModeChange={vi.fn()} />);
  expect(screen.queryByTitle("ChatGPT 原生桌面")).toBeNull();
});

it("uses only the fixed same-origin viewer and retains its document across mode switches", () => {
  const view = render(
    <ChatgptNativeDesktopApp active onModeChange={vi.fn()} />,
  );
  const frame = screen.getByTitle("ChatGPT 原生桌面");
  expect(frame.getAttribute("src")).toBe(
    "/chatgpt-remote-desktop/vnc.html?autoconnect=true&resize=off&path=chatgpt-remote-desktop%2Fwebsockify",
  );
  view.rerender(
    <ChatgptNativeDesktopApp active={false} onModeChange={vi.fn()} />,
  );
  expect(screen.getByTitle("ChatGPT 原生桌面")).toBe(frame);
  view.rerender(<ChatgptNativeDesktopApp active onModeChange={vi.fn()} />);
  expect(screen.getByTitle("ChatGPT 原生桌面")).toBe(frame);
});

it("keeps the three visible mode choices without sending a desktop operation", () => {
  const change = vi.fn();
  render(<ChatgptNativeDesktopApp active onModeChange={change} />);
  for (const name of ["会话", "终端", "Codex"])
    expect(screen.getByRole("button", { name })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "ChatGPT" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "终端" }));
  expect(change).toHaveBeenCalledWith("terminal");
});

function nativeClipboard(
  view = render(<ChatgptNativeDesktopApp active onModeChange={vi.fn()} />),
) {
  const frame = screen.getByTitle("ChatGPT 原生桌面") as HTMLIFrameElement;
  const doc = frame.contentDocument!;
  doc.open();
  doc.write('<!doctype html><html class="noVNC_connected"><body><button id="noVNC_clipboard_button">Clipboard</button><div id="noVNC_clipboard"><textarea id="noVNC_clipboard_text">unchanged</textarea></div><textarea id="noVNC_keyboardinput"></textarea></body></html>');
  doc.close();
  const panel = doc.getElementById("noVNC_clipboard")!;
  const open = vi.fn(() => panel.classList.add("noVNC_open"));
  doc.getElementById("noVNC_clipboard_button")!.addEventListener("click", open);
  return { view, frame, doc, open,
    input: doc.getElementById("noVNC_clipboard_text") as HTMLTextAreaElement,
    keyboard: doc.getElementById("noVNC_keyboardinput") as HTMLTextAreaElement,
  };
}

it("opens the authenticated clipboard explicitly without typing, submitting or using limited Unicode keycodes", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const { input, doc, open, keyboard } = nativeClipboard();
  const focus = vi.spyOn(input, "focus");
  const keys = vi.spyOn(keyboard, "focus");
  const inputEvent = vi.fn(), keyEvent = vi.fn();
  input.addEventListener("input", inputEvent);
  input.addEventListener("keydown", keyEvent);
  expect(focus).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "粘贴文字" });
  fireEvent.click(button);
  expect(open).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  expect(doc.activeElement).toBe(input);
  expect(input.value).toBe("unchanged");
  expect(inputEvent).not.toHaveBeenCalled();
  expect(keyEvent).not.toHaveBeenCalled();
  expect(keys).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(open).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalledTimes(2);
});

it("does not open or focus the clipboard while hidden or when becoming active again", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const { view, input, frame, open } = nativeClipboard();
  const focus = vi.spyOn(input, "focus");
  view.rerender(<ChatgptNativeDesktopApp active={false} onModeChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "粘贴文字", hidden: true }));
  view.rerender(<ChatgptNativeDesktopApp active onModeChange={vi.fn()} />);
  expect(screen.getByTitle("ChatGPT 原生桌面")).toBe(frame);
  expect(open).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
});

it("refuses a disconnected, cross-origin or background clipboard viewer", () => {
  const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const { input, doc, frame, open } = nativeClipboard();
  const focus = vi.spyOn(input, "focus");
  const button = screen.getByRole("button", { name: "粘贴文字" });
  doc.documentElement.classList.remove("noVNC_connected");
  fireEvent.click(button);
  doc.documentElement.classList.add("noVNC_connected");
  visible.mockReturnValue("hidden");
  fireEvent.click(button);
  visible.mockReturnValue("visible");
  frame.src = "https://other.example/vnc.html";
  fireEvent.click(button);
  expect(open).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
});
