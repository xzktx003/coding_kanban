import { expect, it } from "vitest";
import { suggestionPosition } from "./suggestionPosition";
it("keeps a wide popup inside a narrow phone viewport", () => {
  const p = suggestionPosition(
    { left: 330, top: 500, bottom: 560 },
    { left: 0, top: 0, width: 375, height: 667 },
  );
  expect(p.left).toBe(12);
  expect(p.width).toBe(351);
  expect(p.bottom).toBe(175);
  expect(p.maxHeight).toBeLessThanOrEqual(480);
});
it("flips below a high composer and respects a mobile keyboard viewport", () => {
  const p = suggestionPosition(
    { left: 15, top: 25, bottom: 60 },
    { left: 0, top: 0, width: 375, height: 300 },
  );
  expect(p.top).toBe(68);
  expect(p.maxHeight).toBe(220);
});
