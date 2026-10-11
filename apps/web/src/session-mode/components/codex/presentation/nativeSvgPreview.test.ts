import { expect, it } from "vitest";
import { isNativeSvgPreview, nativeSvgPreviewSource } from "./nativeSvgPreview";

it("uses native SVG detection without treating arbitrary HTML/XML or language names as images", () => {
  expect(isNativeSvgPreview("partial", "svg")).toBe(true);
  expect(isNativeSvgPreview(' \n<svg viewBox="0 0 1 1">', "html")).toBe(true);
  for (const [code, language] of [
    ["<main><svg/></main>", "html"],
    ["<!-- SVG --><svg/>", "xml"],
    ["<svg/>", "text"],
    ["<svg/>", "SVG"],
  ])
    expect(isNativeSvgPreview(code, language)).toBe(false);
});

it("normalizes xlink into href while preserving explicit href and source callers", () => {
  const code =
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#old"/><use xlink:href="#old" href="#new"/></svg>';
  const source = nativeSvgPreviewSource(code)!;
  const markup = decodeURIComponent(source.slice(source.indexOf(",") + 1));
  expect(markup).toContain('href="#old"');
  expect(markup).toContain('href="#new"');
  expect(markup).not.toContain("xlink:href");
  expect(code).toContain("xlink:href");
});

it("repairs trailing incomplete tag starts like the original and handles empty output", () => {
  expect(nativeSvgPreviewSource("")).toBeNull();
  expect(
    nativeSvgPreviewSource('<svg xmlns="http://www.w3.org/2000/svg"><'),
  ).toBe(nativeSvgPreviewSource('<svg xmlns="http://www.w3.org/2000/svg">'));
});
