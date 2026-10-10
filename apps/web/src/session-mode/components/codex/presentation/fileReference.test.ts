import { expect, it } from "vitest";
import { parseFileReference, resolveLiteralFilePath } from "./fileReference";
it("parses native locations without treating colons as part of the filename", () => {
  expect(parseFileReference("src/file.ts:42:3", "/owner")).toEqual({
    path: "/owner/src/file.ts",
    line: 42,
    column: 3,
  });
  expect(parseFileReference("../shared/file.ts#L12-L18", "/owner/src")).toEqual(
    { path: "/owner/shared/file.ts", line: 12 },
  );
  expect(parseFileReference("file:///C:/src/file.ts:9:2")).toEqual({
    path: "C:\\src\\file.ts",
    line: 9,
    column: 2,
  });
  expect(parseFileReference("file:///owner/a%20b.ts#L4")).toEqual({
    path: "/owner/a b.ts",
    line: 4,
  });
});
it("does not turn external, unsafe or unresolved links into workspace paths", () => {
  for (const href of [
    "https://example.org:42",
    "javascript:alert(1)",
    "ja%76ascript:alert(1)",
    "data:text/html,hello",
    "#heading",
    "file://foreign-host/path",
    "%ZZ",
    "file.ts:0",
    "relative.ts",
  ])
    expect(parseFileReference(href)).toBeNull();
});
it("resolves protocol paths literally, including percent signs and location-like suffixes", () => {
  expect(resolveLiteralFilePath("src/../100%done:42#L4?.md", "/a")).toBe(
    "/a/100%done:42#L4?.md",
  );
  expect(resolveLiteralFilePath("C:\\a\\..\\file:42")).toBe("C:\\file:42");
  expect(resolveLiteralFilePath("\\\\server\\share\\file")).toBe(
    "\\\\server\\share\\file",
  );
  expect(resolveLiteralFilePath("relative")).toBeNull();
  for (const value of [
    "javascript:alert(1)",
    "https://example.org/file",
    "/a\u0000file",
  ])
    expect(resolveLiteralFilePath(value, "/a")).toBeNull();
});
