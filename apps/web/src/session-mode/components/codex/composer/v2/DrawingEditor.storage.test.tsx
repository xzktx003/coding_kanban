import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DrawingDocument } from "./drawing";
const exportImage = vi.hoisted(() => vi.fn());
vi.mock("./drawing", async (original) => ({
  ...(await original<object>()),
  drawingToFile: exportImage,
}));
vi.mock("./ComposerSheet", () => ({
  ComposerSheet: ({ children, footer }: any) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
import { DrawingEditor } from "./DrawingEditor";
import { composerDrafts } from "./drafts";
import { contextDraftStorage, emptyRecord, revised } from "./draftStorage";
const document = (ids: string[]): DrawingDocument => ({
  version: 1,
  width: 1200,
  height: 800,
  marks: ids.map((id) => ({
    id,
    kind: "pen",
    color: "#000",
    width: 2,
    points: [
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ],
  })),
});
afterEach(() => {
  vi.restoreAllMocks();
  exportImage.mockReset();
});

it("a delayed image export clears only its captured drawing and preserves later strokes", async () => {
  const owner = "drawing-export:" + crypto.randomUUID();
  await composerDrafts.ensure(owner);
  composerDrafts.drawing(owner, "sketch", document(["exported"]));
  await composerDrafts.flush(owner);
  let release!: (file: File) => void;
  exportImage.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const addFiles = vi.fn(),
    close = vi.fn();
  render(
    <DrawingEditor
      owner={owner}
      attachments={{ addFiles } as any}
      onClose={close}
    />,
  );
  fireEvent.click(screen.getByText("完成并附加"));
  await waitFor(() => expect(exportImage).toHaveBeenCalledOnce());
  act(() =>
    composerDrafts.drawing(owner, "sketch", document(["exported", "later"])),
  );
  await act(async () => composerDrafts.flush(owner));
  await act(async () =>
    release(new File(["rendered bytes"], "drawing.png", { type: "image/png" })),
  );
  await waitFor(() => expect(addFiles).toHaveBeenCalledOnce());
  expect(
    addFiles.mock.calls[0][1].document.marks.map((mark: any) => mark.id),
  ).toEqual(["exported"]);
  await act(async () => composerDrafts.flush(owner));
  expect(
    (await contextDraftStorage.load(owner)).drawings.sketch.value.marks.map(
      (mark) => mark.id,
    ),
  ).toEqual(["exported", "later"]);
  expect(close).toHaveBeenCalledOnce();
});

it("late hydration merges saved strokes without replacing a real pointer stroke started before it completed", async () => {
  const owner = "drawing-hydrate:" + crypto.randomUUID();
  await contextDraftStorage.save(owner, emptyRecord(), {
    ...emptyRecord(),
    drawings: { sketch: revised(document(["saved"])) },
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = contextDraftStorage.load;
  vi.spyOn(contextDraftStorage, "load").mockImplementation(async (key) => {
    if (key === owner) await gate;
    return load(key);
  });
  render(
    <DrawingEditor
      owner={owner}
      attachments={{ addFiles: vi.fn() } as any}
      onClose={vi.fn()}
    />,
  );
  const svg = screen.getByLabelText("绘图画布");
  Object.defineProperty(svg, "setPointerCapture", { value: vi.fn() });
  Object.defineProperty(svg, "releasePointerCapture", { value: vi.fn() });
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 1200,
    height: 800,
    right: 1200,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: x,
      clientY: y,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(svg, event);
  };
  pointer("pointerdown", 10, 10);
  pointer("pointermove", 30, 30);
  pointer("pointerup", 30, 30);
  const own = composerDrafts.read(owner).drawings.sketch?.marks[0]?.id;
  expect(own).toBeTruthy();
  await act(async () => release());
  await act(async () => composerDrafts.flush(owner));
  expect(
    composerDrafts.read(owner).drawings.sketch.marks.map((mark) => mark.id),
  ).toEqual(["saved", own]);
  await waitFor(() =>
    expect(svg.querySelectorAll("polyline[stroke]")).toHaveLength(2),
  );
});

it("a drawing conflict retains local strokes until explicit restore chooses the saved drawing", async () => {
  const owner = "drawing-conflict:" + crypto.randomUUID();
  await composerDrafts.ensure(owner);
  composerDrafts.drawing(owner, "sketch", document(["shared"]));
  await composerDrafts.flush(owner);
  render(
    <DrawingEditor
      owner={owner}
      attachments={{ addFiles: vi.fn() } as any}
      onClose={vi.fn()}
    />,
  );
  const before = await contextDraftStorage.load(owner);
  const changed = (color: string) => ({
    ...document(["shared"]),
    marks: document(["shared"]).marks.map((mark) => ({ ...mark, color })),
  });
  await contextDraftStorage.save(owner, before, {
    ...before,
    drawings: { sketch: revised(changed("#f00")) },
  });
  act(() => composerDrafts.drawing(owner, "sketch", changed("#0f0")));
  await act(async () => {
    await expect(composerDrafts.flush(owner)).rejects.toThrow("另一页面");
  });
  expect(composerDrafts.read(owner).drawings.sketch.marks[0].color).toBe(
    "#0f0",
  );
  fireEvent.click(await screen.findByText("舍弃本页未保存笔画"));
  await waitFor(() =>
    expect(composerDrafts.read(owner).drawings.sketch.marks[0].color).toBe(
      "#f00",
    ),
  );
  await composerDrafts.flush(owner);
  expect(
    (await contextDraftStorage.load(owner)).drawings.sketch.value.marks[0]
      .color,
  ).toBe("#f00");
});
