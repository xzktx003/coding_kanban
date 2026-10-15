import { expect, it } from "vitest";
import { isLocalChatImage, resolveChatImageSource } from "./chatImageSource";
it.each([
  ["/project/草图.png", "/project/草图.png"],
  ["./images/草图%20一.png", "/project/images/草图 一.png"],
  ["images/a%23b%3Fc%25.png?preview=1", "/project/images/a#b?c%.png"],
  ["file:///project/images/a%20b.png", "/project/images/a b.png"],
  ["images/../sketch.png", "/project/sketch.png"],
])("resolves local path %s in its captured project", (source, result) => {
  expect(isLocalChatImage(source)).toBe(true);
  expect(resolveChatImageSource(source, "/project")).toBe(result);
});
it.each([
  "https://fixture.invalid/image.png",
  "data:image/png;base64,AA==",
  "blob:image",
  "javascript:alert(1)",
  "//fixture.invalid/image.png",
  "#image",
])("does not classify a web/protocol source as local: %s", (source) => {
  expect(isLocalChatImage(source)).toBe(false);
});
it.each([
  "../secret.png",
  "/project-other/secret.png",
  "/elsewhere/secret.png",
  "file://remote/project/image.png",
  "images/%00.png",
  "images/%5csecret.png",
  "images/%ZZ.png",
])("rejects unsafe local path %s", (source) => {
  expect(() => resolveChatImageSource(source, "/project")).toThrow();
});
it("never uses another project when the original project is unavailable", () => {
  expect(() => resolveChatImageSource("./image.png", undefined)).toThrow();
});
