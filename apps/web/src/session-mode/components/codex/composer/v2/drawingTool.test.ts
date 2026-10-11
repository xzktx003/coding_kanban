import { expect, it, vi } from "vitest";
import {
  onCanvasPrompt,
  onDrawingTool,
  requestCanvasPrompt,
  requestDrawingTool,
} from "./drawingTool";

it("notifies the open drawing editor of the requested tool", () => {
  const heard = vi.fn();
  const stop = onDrawingTool(heard);
  requestDrawingTool("arrow");
  requestDrawingTool("hand");
  expect(stop()).toBeUndefined();
  expect(stop()).toBeUndefined();
  requestDrawingTool("pen");
  expect(heard.mock.calls).toEqual([["arrow"], ["hand"]]);
});

it("opens the canvas prompt at the requested pointer", () => {
  const heard = vi.fn();
  const stop = onCanvasPrompt(heard);
  requestCanvasPrompt({ x: 12, y: 40 });
  requestCanvasPrompt(null);
  expect(stop()).toBeUndefined();
  expect(stop()).toBeUndefined();
  requestCanvasPrompt({ x: 1, y: 1 });
  expect(heard.mock.calls).toEqual([[{ x: 12, y: 40 }], [null]]);
});
