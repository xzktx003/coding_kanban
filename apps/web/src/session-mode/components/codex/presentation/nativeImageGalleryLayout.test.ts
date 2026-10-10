import { expect, it } from "vitest";
import { nativeImageGalleryLayout } from "./nativeImageGalleryLayout";
it("matches native four-slot carousel sizing while preserving actual natural aspect ratios", () => {
  expect(nativeImageGalleryLayout(584, [5 / 3, 5 / 3])).toEqual({
    height: 140,
    square: false,
    visibleCount: 2,
    maxStartIndex: 0,
    overflowCount: 0,
  });
  expect(nativeImageGalleryLayout(584, [1, 1, 1, 1, 1])).toEqual({
    height: 140,
    square: true,
    visibleCount: 4,
    maxStartIndex: 1,
    overflowCount: 1,
  });
  expect(nativeImageGalleryLayout(480, [5 / 3])).toMatchObject({
    height: 288,
    square: false,
  });
  expect(nativeImageGalleryLayout(480, [1], 4)).toMatchObject({
    height: 114,
    square: false,
  });
});
