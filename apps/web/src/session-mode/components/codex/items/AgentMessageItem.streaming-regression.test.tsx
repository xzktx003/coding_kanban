import { render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { AgentMessageItem } from "./AgentMessageItem";
import {
  createStreamingTextPreview,
  STREAMING_TEXT_LIMIT,
  STREAMING_TEXT_PREVIEW_MARKER,
  STREAMING_TEXT_SEGMENT_CHARS,
} from "@session/services/codexTranscriptMemoryBudget";

it("keeps the rendered beginning when the live text becomes a bounded preview", async () => {
  const text = "**保留标题**\n\n" + "x".repeat(STREAMING_TEXT_LIMIT);
  const segments = Array.from(
    {
      length: Math.floor(
        (STREAMING_TEXT_LIMIT - 1) / STREAMING_TEXT_SEGMENT_CHARS,
      ),
    },
    (_, i) =>
      text.slice(
        i * STREAMING_TEXT_SEGMENT_CHARS,
        (i + 1) * STREAMING_TEXT_SEGMENT_CHARS,
      ),
  );
  const view = render(
    <AgentMessageItem
      threadId="thread"
      itemId="item"
      text=""
      streaming
      streamingSegments={segments}
    />,
  );
  await waitFor(() =>
    expect(view.container.querySelector("strong")?.textContent).toBe(
      "保留标题",
    ),
  );
  view.rerender(
    <AgentMessageItem
      threadId="thread"
      itemId="item"
      text=""
      streaming
      streamingPreview={createStreamingTextPreview(text)}
    />,
  );
  expect(view.container.querySelector("strong")?.textContent).toBe("保留标题");
  expect(view.container.textContent?.match(/保留标题/g)).toHaveLength(1);
  expect(view.container.textContent).toContain(STREAMING_TEXT_PREVIEW_MARKER);
  expect(
    view.container.querySelectorAll("[data-codex-streaming-text]"),
  ).toHaveLength(1);
  expect(view.container.textContent!.length).toBeLessThanOrEqual(
    STREAMING_TEXT_LIMIT,
  );
});

it.each([
  ':codex-file-citation{path="/owner/source.ts"}',
  "【/owner/source.ts†L8】",
])(
  "keeps a rendered file citation over both stream budgets",
  async (citation) => {
    const text = citation + "x".repeat(STREAMING_TEXT_LIMIT);
    const first = text.slice(0, STREAMING_TEXT_SEGMENT_CHARS);
    const second = text.slice(
      STREAMING_TEXT_SEGMENT_CHARS,
      2 * STREAMING_TEXT_SEGMENT_CHARS,
    );
    const view = render(
      <AgentMessageItem
        threadId="thread"
        itemId="item"
        text=""
        streaming
        streamingCurrent={first}
      />,
    );
    await waitFor(() =>
      expect(
        view.container.querySelector(".native-file-citation"),
      ).not.toBeNull(),
    );
    view.rerender(
      <AgentMessageItem
        threadId="thread"
        itemId="item"
        text=""
        streaming
        streamingSegments={[first, second]}
        streamingCurrent="x"
      />,
    );
    expect(
      view.container.querySelector(".native-file-citation"),
    ).not.toBeNull();
    view.rerender(
      <AgentMessageItem
        threadId="thread"
        itemId="item"
        text=""
        streaming
        streamingPreview={createStreamingTextPreview(text)}
      />,
    );
    expect(
      view.container.querySelector(".native-file-citation"),
    ).not.toBeNull();
    expect(view.container.textContent).not.toContain(citation);
  },
);

it("keeps a file citation whose directive is split at a segment boundary", async () => {
  const citation = ':codex-file-citation{path="/owner/source.ts"}';
  const text =
    "x".repeat(STREAMING_TEXT_SEGMENT_CHARS - ":codex-".length) +
    citation +
    "x".repeat(STREAMING_TEXT_LIMIT);
  const segments = [
    text.slice(0, STREAMING_TEXT_SEGMENT_CHARS),
    text.slice(STREAMING_TEXT_SEGMENT_CHARS, 2 * STREAMING_TEXT_SEGMENT_CHARS),
  ];
  const view = render(
    <AgentMessageItem
      threadId="thread"
      itemId="item"
      text=""
      streaming
      streamingSegments={segments}
      streamingCurrent="x"
    />,
  );
  await waitFor(() =>
    expect(
      view.container.querySelector(".native-file-citation"),
    ).not.toBeNull(),
  );
  view.rerender(
    <AgentMessageItem
      threadId="thread"
      itemId="item"
      text=""
      streaming
      streamingPreview={createStreamingTextPreview(text)}
    />,
  );
  expect(view.container.querySelector(".native-file-citation")).not.toBeNull();
  expect(view.container.textContent).not.toContain(citation);
});
