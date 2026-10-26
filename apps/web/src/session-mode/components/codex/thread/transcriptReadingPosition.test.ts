import { describe, expect, it, vi } from "vitest";
import { captureTranscriptReadingPosition } from "./transcriptReadingPosition";

function viewport() {
  const element = document.createElement("div");
  element.scrollTop = 412.5;
  Object.defineProperty(element, "clientHeight", { value: 200 });
  const rect = vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    top: 100,
    bottom: 300,
  } as DOMRect);
  return { element, rect };
}
function appendRow(
  element: HTMLElement,
  key: string,
  top: number,
  bottom: number,
) {
  const row = document.createElement("div");
  row.dataset.codexRow = key;
  const rect = vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    top,
    bottom,
  } as DOMRect);
  element.append(row);
  return { row, rect };
}

describe("transcript reading snapshots", () => {
  it("records latest without measuring a row that may already be leaving the layout", () => {
    const { element, rect } = viewport();
    const row = appendRow(element, "latest", 200, 350);
    expect(captureTranscriptReadingPosition(element, true)).toEqual({
      atBottom: true,
      offset: 0,
      scrollTop: 0,
      format: "row",
    });
    expect(rect).not.toHaveBeenCalled();
    expect(row.rect).not.toHaveBeenCalled();
  });
  it("records latest even after all virtual rows have been removed", () => {
    const { element, rect } = viewport();
    Object.defineProperty(element, "scrollTop", {
      get: () => {
        throw new Error("An exiting latest viewport must not require layout");
      },
    });
    expect(captureTranscriptReadingPosition(element, true)?.atBottom).toBe(
      true,
    );
    expect(rect).not.toHaveBeenCalled();
  });
  it("captures the first actually visible reader and its fractional offset", () => {
    const { element } = viewport();
    const above = appendRow(element, "above", 10, 100);
    const visible = appendRow(element, "reader", 73.25, 180);
    const below = appendRow(element, "below", 300, 460);
    expect(captureTranscriptReadingPosition(element, false)).toEqual({
      atBottom: false,
      anchor: "reader",
      offset: 26.75,
      scrollTop: 412.5,
      format: "row",
    });
    expect(above.rect).toHaveBeenCalledTimes(1);
    expect(visible.rect).toHaveBeenCalledTimes(1);
    expect(below.rect).not.toHaveBeenCalled();
  });
  it("does not invent an anchor when no row intersects the reader", () => {
    const { element } = viewport();
    appendRow(element, "above", 10, 100);
    appendRow(element, "below", 300, 460);
    expect(captureTranscriptReadingPosition(element, false)).toBeUndefined();
  });
});
