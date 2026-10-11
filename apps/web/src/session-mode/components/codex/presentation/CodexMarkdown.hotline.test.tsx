import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CodexMarkdown } from "./CodexMarkdown";
import { nativeHotlineLink } from "./nativeHotlineLink";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));

it.each([
  "https://example.com/contact?x=1&",
  "tel:+12025550123?",
  "sms:+12025550123?",
])(
  "cleans the native hotline marker without losing the actual target: %s",
  async (prefix) => {
    const raw = prefix + "oai_link_source=model_response_hotline#section";
    render(<CodexMarkdown value={`[Contact](${raw})`} />);
    const link = await screen.findByText("Contact");
    expect(link.closest("a")?.getAttribute("href")).toBe(
      nativeHotlineLink(raw),
    );
  },
);

it("preserves unrelated, encoded, and nonstandalone tokens", () => {
  expect(
    nativeHotlineLink(
      "https://example.com?x=oai_link_source=model_response_hotline",
    ),
  ).toBeNull();
  expect(
    nativeHotlineLink(
      "https://example.com?oai_link_source=%6dodel_response_hotline",
    ),
  ).toBeNull();
  expect(
    nativeHotlineLink(
      "https://example.com?oai_link_source=model_response_hotline_extra",
    ),
  ).toBeNull();
  expect(
    nativeHotlineLink(
      "mailto:user@example.com?oai_link_source=model_response_hotline",
    ),
  ).toBeNull();
  expect(
    nativeHotlineLink(
      "https://example.com?a=1&oai_link_source=model_response_hotline&b=%2F&oai_link_source=model_response_hotline#hash",
    ),
  ).toBe("https://example.com/?a=1&b=%2F#hash");
});

it("continues to reject executable links while allowing ordinary SMS links", async () => {
  const view = render(
    <CodexMarkdown value="[unsafe](javascript:alert%281%29) [Text](sms:+12025550123?body=hello%20world)" />,
  );
  await screen.findByText("Text");
  expect(view.container.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(
    view.container.querySelector('a[href^="sms:"]')?.getAttribute("href"),
  ).toBe("sms:+12025550123?body=hello%20world");
});
