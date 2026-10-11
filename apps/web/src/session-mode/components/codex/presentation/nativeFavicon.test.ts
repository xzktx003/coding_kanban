import { expect, it } from "vitest";
import { nativeFaviconUrl } from "./nativeFavicon";
it("native xNi sends only the HTTP origin, without path, query, hash or credentials", () => {
  const url = nativeFaviconUrl(
    "https://user:pass@example.com/private/path?secret=value#part",
  )!;
  expect(new URL(url).searchParams.get("url")).toBe("https://example.com");
  expect(nativeFaviconUrl("https://example.com/different")).toBe(
    nativeFaviconUrl("https://example.com/private?q=1"),
  );
  expect(
    new URL(nativeFaviconUrl("http://example.com:1234/path")!).searchParams.get(
      "url",
    ),
  ).toBe("http://example.com:1234");
  for (const href of [
    "mailto:user@example.com",
    "javascript:alert(1)",
    "bad url",
  ])
    expect(nativeFaviconUrl(href)).toBeNull();
});
