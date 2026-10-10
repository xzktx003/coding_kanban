import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
const api = vi.hoisted(() => ({ readFile: vi.fn() }));
vi.mock("@session/services/apiAdapt/filesystem", () => api);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
import { EventItem } from "./EventItem";
import { CodexContentOwner } from "../presentation/ownerContext";
import { useCodexStore } from "../stores/useCodexStore";
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/DZkAAAAASUVORK5CYII=";
const event = (type: string, data: any, method = "item/completed") =>
  ({
    method,
    params: {
      threadId: "owner",
      turnId: "turn",
      item: { id: "item", type, ...data },
    },
  }) as any;
beforeEach(() => {
  vi.clearAllMocks();
  api.readFile.mockResolvedValue(png);
});
it("renders a semantic search summary with native query normalization", () => {
  render(
    <EventItem
      event={event("webSearch", {
        query: "ignored",
        action: {
          type: "search",
          query: "codex site:openai.com OR site:developers.openai.com",
          queries: null,
        },
        results: null,
      })}
    />,
  );
  expect(screen.getByText("activity.searchedWeb")).toBeTruthy();
  expect(
    screen.getByText("：codex | openai.com · developers.openai.com"),
  ).toBeTruthy();
  expect(screen.queryByText("webSearch")).toBeNull();
});
it("opens and finds pages using their real action detail", () => {
  const { rerender } = render(
    <EventItem
      event={event("webSearch", {
        query: "",
        action: { type: "openPage", url: "https://example.org" },
        results: null,
      })}
    />,
  );
  expect(screen.getByText("：https://example.org")).toBeTruthy();
  rerender(
    <EventItem
      event={event("webSearch", {
        query: "",
        action: {
          type: "findInPage",
          url: "https://example.org",
          pattern: "sessions",
        },
        results: null,
      })}
    />,
  );
  expect(screen.getByText("：'sessions' in https://example.org")).toBeTruthy();
});
it("renders a generated image from the real result rather than JSON", () => {
  render(
    <EventItem
      event={event("imageGeneration", {
        result: png,
        revisedPrompt: "a small image",
        status: "completed",
      })}
    />,
  );
  expect(
    screen
      .getByRole("img", { name: "activity.generatedImage" })
      .getAttribute("src"),
  ).toBe(`data:image/png;base64,${png}`);
  expect(screen.queryByText("imageGeneration")).toBeNull();
});
it("reads an inspected image only after disclosure, and supports original-size preview", async () => {
  render(
    <EventItem event={event("imageView", { path: "/owner/image.png" })} />,
  );
  expect(api.readFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /activity.viewedImage/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("img", { name: "activity.inspectedImage" }),
    ).toBeTruthy(),
  );
  expect(api.readFile).toHaveBeenCalledWith("/owner/image.png");
  fireEvent.click(
    screen.getByRole("button", { name: "放大activity.inspectedImage" }),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("shows compaction status and omits the plugin-hidden sleep row", () => {
  const { rerender } = render(
    <EventItem event={event("contextCompaction", {})} />,
  );
  expect(screen.getByText("activity.contextCompacted")).toBeTruthy();
  rerender(<EventItem event={event("sleep", { durationMs: 10000 })} />);
  expect(screen.queryByText("sleep")).toBeNull();
  expect(document.body.textContent).toBe("");
});
it("keeps the native generic dynamic-tool fallback compact without exposing args or results as invented native body", () => {
  render(
    <EventItem
      event={event("dynamicToolCall", {
        namespace: "functions",
        tool: "inspect",
        status: "completed",
        arguments: {},
        contentItems: [
          { type: "inputText", text: "dynamic content" },
          { type: "inputImage", imageUrl: `data:image/png;base64,${png}` },
          { type: "inputAudio", audioUrl: "data:audio/wav;base64,AA==" },
        ],
        success: true,
        durationMs: 200,
      })}
    />,
  );
  expect(screen.getByText("Inspect")).toBeTruthy();
  expect(screen.queryByText("dynamic content")).toBeNull();
  expect(screen.queryByRole("button", { name: /Inspect/ })).toBeNull();
  expect(document.querySelector("audio[controls]")).toBeNull();
});
it("an interrupted lifecycle stops activity without claiming successful results", () => {
  render(
    <EventItem
      event={event(
        "dynamicToolCall",
        {
          namespace: "functions",
          tool: "inspect",
          status: "inProgress",
          arguments: {},
          contentItems: null,
          success: null,
          durationMs: null,
        },
        "item/started",
      )}
      context={{ renderTermination: "interrupted" }}
    />,
  );
  expect(screen.getByText("Inspect")).toBeTruthy();
  expect(document.querySelector(".animate-spin")).toBeNull();
});

it("joins in-flight image reads when strict-mode remounts the same preview", async () => {
  render(
    <StrictMode>
      <EventItem event={event("imageView", { path: "/owner/image.png" })} />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole("button", { name: /activity.viewedImage/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("img", { name: "activity.inspectedImage" }),
    ).toBeTruthy(),
  );
  expect(api.readFile).toHaveBeenCalledTimes(1);
});

it("inspects a native multiple-image gallery lazily and binds reads to the event owner", async () => {
  useCodexStore.setState({
    threads: [
      { id: "owner", cwd: "/owner" },
      { id: "active", cwd: "/active" },
    ] as never,
  });
  render(
    <CodexContentOwner.Provider value="active">
      <EventItem
        event={event("imageView", {
          path: "one.png",
          imagePaths: ["one.png", "two.png"],
          imageCount: 2,
        })}
      />
    </CodexContentOwner.Provider>,
  );
  expect(api.readFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /2/ }));
  await waitFor(() =>
    expect(
      screen.getAllByRole("img", { name: /activity.inspectedImage/ }),
    ).toHaveLength(2),
  );
  expect(api.readFile).toHaveBeenCalledWith("/owner/one.png");
  expect(api.readFile).toHaveBeenCalledWith("/owner/two.png");
  expect(api.readFile).not.toHaveBeenCalledWith("/active/one.png");
});

it("does not briefly show another owner's relative image while its replacement loads", async () => {
  useCodexStore.setState({
    threads: [
      { id: "one", cwd: "/one" },
      { id: "two", cwd: "/two" },
    ] as never,
  });
  let resolve!: (value: string) => void;
  const value = event("imageView", { path: "image.png" });
  value.params.threadId = "one";
  const { rerender } = render(
    <CodexContentOwner.Provider value="one">
      <EventItem event={value} />
    </CodexContentOwner.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /activity.viewedImage/ }));
  await waitFor(() =>
    expect(
      screen.getByRole("img", { name: "activity.inspectedImage" }),
    ).toBeTruthy(),
  );
  api.readFile.mockImplementationOnce(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  rerender(
    <CodexContentOwner.Provider value="two">
      <EventItem
        event={{ ...value, params: { ...value.params, threadId: "two" } }}
      />
    </CodexContentOwner.Provider>,
  );
  expect(
    screen.queryByRole("img", { name: "activity.inspectedImage" }),
  ).toBeNull();
  expect(api.readFile).toHaveBeenLastCalledWith("/two/image.png");
  resolve(png);
  await waitFor(() =>
    expect(
      screen.getByRole("img", { name: "activity.inspectedImage" }),
    ).toBeTruthy(),
  );
});
