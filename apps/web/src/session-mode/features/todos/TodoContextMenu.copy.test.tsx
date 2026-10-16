import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { Todo } from "@session/stores/useTodoStore";
import { clipboardFixture, deferredClipboard } from "@session/test/clipboardFixture";
import { TodoContextMenu } from "./TodoContextMenu";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
const original: Todo[] = [
  { id: "one", text: "  原文 citefixture  ", isDone: false, createdAt: 1, categoryId: null, pinnedAt: null },
  { id: "two", text: "second\nline", isDone: false, createdAt: 2, categoryId: null, pinnedAt: null },
];
let clipboard: ReturnType<typeof clipboardFixture>;
beforeEach(() => { clipboard = clipboardFixture(); vi.clearAllMocks(); });
afterEach(() => clipboard.restore());
function menu(targets: Todo[], done = vi.fn()) {
  return <TodoContextMenu targets={targets} categories={[]} isExpanded={false} onToggleDone={done}
    onPin={vi.fn()} onMove={vi.fn()} onToggleExpand={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onSendToComposer={vi.fn()}>
    <button>fixture todo</button>
  </TodoContextMenu>;
}
async function select(label: string) {
  fireEvent.contextMenu(screen.getByRole("button", { name: "fixture todo" }), { clientX: 20, clientY: 20 });
  fireEvent.click(await screen.findByRole("menuitem", { name: new RegExp(`^${label} \\(2\\)`) }));
}

describe.each(["Copy", "Copy as list"])("%s", (label) => {
  const text = original.map(todo => `${label === "Copy" ? "" : "- "}${todo.text}`).join("\n");
  it("copies the full original text over HTTP and only then marks the captured targets done", async () => {
    const done = vi.fn();
    render(menu(original, done));
    await select(label);
    await waitFor(() => expect(done).toHaveBeenCalledWith(true));
    expect(clipboard.texts).toEqual([text]);
    expect(clipboard.copyEvents).toEqual([expect.objectContaining({ data: { "text/plain": text }, defaultPrevented: true })]);
  });
  it("does not mark targets done while pending or after rejection", async () => {
    const write = deferredClipboard();
    const writeText = vi.fn(() => write.promise);
    clipboard.modern(writeText);
    const done = vi.fn();
    render(menu(original, done));
    await select(label);
    expect(writeText).toHaveBeenCalledWith(text);
    expect(done).not.toHaveBeenCalled();
    await act(async () => write.reject(new Error("denied")));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(done).not.toHaveBeenCalled();
  });
  it("does not mark targets done when legacy copy returns false", async () => {
    clipboard.legacy.mockReturnValue(false);
    const done = vi.fn();
    render(menu(original, done));
    await select(label);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(done).not.toHaveBeenCalled();
  });
  it("waits for actual success and calls the original callback while the ID set remains valid", async () => {
    const write = deferredClipboard();
    clipboard.modern(vi.fn(() => write.promise));
    const oldDone = vi.fn(), newDone = vi.fn();
    const view = render(<StrictMode>{menu(original, oldDone)}</StrictMode>);
    await select(label);
    expect(oldDone).not.toHaveBeenCalled();
    view.rerender(<StrictMode>{menu([...original].reverse(), newDone)}</StrictMode>);
    await act(async () => write.resolve());
    expect(oldDone).toHaveBeenCalledExactlyOnceWith(true);
    expect(newDone).not.toHaveBeenCalled();
  });
});

it("revokes a pending completion when the selection changes and permits a later explicit copy", async () => {
  const write = deferredClipboard();
  clipboard.modern(vi.fn(() => write.promise));
  const oldDone = vi.fn(), newDone = vi.fn();
  const view = render(menu(original, oldDone));
  await select("Copy");
  const next = original.map(todo => ({ ...todo, id: `new-${todo.id}`, text: "new selection" }));
  view.rerender(menu(next, newDone));
  await act(async () => write.resolve());
  expect(oldDone).not.toHaveBeenCalled();
  expect(newDone).not.toHaveBeenCalled();
  clipboard.modern(vi.fn().mockResolvedValue(undefined));
  await select("Copy");
  await waitFor(() => expect(newDone).toHaveBeenCalledExactlyOnceWith(true));
});

it("releases a pending completion on unmount instead of changing Todo state afterwards", async () => {
  const write = deferredClipboard();
  clipboard.modern(vi.fn(() => write.promise));
  const done = vi.fn();
  const view = render(menu(original, done));
  await select("Copy");
  view.unmount();
  await act(async () => write.resolve());
  expect(done).not.toHaveBeenCalled();
});

it("starts only one write for a pending selection and permits a different selection before the old receipt", async () => {
  const oldWrite = deferredClipboard(), nextWrite = deferredClipboard();
  const writeText = vi.fn().mockReturnValueOnce(oldWrite.promise).mockReturnValueOnce(nextWrite.promise);
  clipboard.modern(writeText);
  const oldDone = vi.fn(), nextDone = vi.fn();
  const view = render(menu(original, oldDone));
  await select("Copy");
  await select("Copy as list");
  expect(writeText).toHaveBeenCalledTimes(1);
  view.rerender(menu(original.map(todo => ({ ...todo, id: `next-${todo.id}` })), nextDone));
  await select("Copy");
  expect(writeText).toHaveBeenCalledTimes(2);
  await act(async () => oldWrite.resolve());
  expect(nextDone).not.toHaveBeenCalled();
  expect(oldDone).not.toHaveBeenCalled();
  await act(async () => nextWrite.resolve());
  expect(nextDone).toHaveBeenCalledExactlyOnceWith(true);
});

it("passes a full large Todo body to the synchronous writer without shortening it", async () => {
  const write = deferredClipboard();
  const writeText = vi.fn(() => write.promise);
  clipboard.modern(writeText);
  const text = `large-fixture:${"x".repeat(262_144)}:end`;
  const done = vi.fn();
  const view = render(menu([{ ...original[0], text }, original[1]], done));
  await select("Copy");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(`${text}\n${original[1].text}`);
  expect(done).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => write.resolve());
  expect(done).not.toHaveBeenCalled();
});

it("does not mark an edited body done when the same IDs receive an old copy receipt", async () => {
  const write = deferredClipboard();
  clipboard.modern(vi.fn(() => write.promise));
  const originalDone = vi.fn(), editedDone = vi.fn();
  const view = render(menu(original, originalDone));
  await select("Copy");
  view.rerender(menu(original.map(todo => todo.id === "one" ? { ...todo, text: "user edited body" } : todo), editedDone));
  await act(async () => write.resolve());
  expect(originalDone).not.toHaveBeenCalled();
  expect(editedDone).not.toHaveBeenCalled();
  clipboard.modern(vi.fn().mockResolvedValue(undefined));
  await select("Copy");
  await waitFor(() => expect(editedDone).toHaveBeenCalledExactlyOnceWith(true));
});
