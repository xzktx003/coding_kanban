import { expect, it } from "vitest";
import {
  nativeSlackResult,
  nativeSlackTarget,
  nativeSlackUrl,
} from "./nativeSlackPreview";
const href =
  "https://team.slack.com/archives/C123/p1700000000000001?thread_ts=1700000000.000000";
const target = nativeSlackTarget(href)!;
it("parses native workspace links and keeps thread and selected message distinct", () => {
  expect(target).toEqual({
    kind: "message",
    hostname: "team.slack.com",
    channelId: "C123",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000000",
  });
  expect(
    nativeSlackTarget("https://app.slack.com/archives/C123/p1700000000000000"),
  ).toBeNull();
  expect(nativeSlackUrl("https://team.enterprise.slack.com/")).not.toBeNull();
});
it.each([
  "http://team.slack.com/",
  "https://team.slack.com.evil.test/",
  "https://api.slack.com/",
  "https://user@team.slack.com/",
  "https://team.slack.com:1234/",
  href.replace("1700000000.000000", "invalid"),
])("does not accept an unsupported Slack target: %s", (href) => {
  expect(nativeSlackTarget(href)).toBeNull();
});
it("selects the exact matched message and releases tool syntax from bounded text", () => {
  const result = {
    structuredContent: {
      slack_data: {
        schema_version: 1,
        ok: true,
        channel_id: "C123",
        message_ts: "1700000000.000000",
        messages: [
          { ts: "1700000000.000000", text: "wrong root" },
          {
            ts: "1700000000.000001",
            text:
              " <https://example.com|Label> &amp; <https://example.com>   " +
              "x".repeat(400),
          },
        ],
      },
    },
  };
  const parsed = nativeSlackResult(result, target);
  expect(parsed).toEqual({
    status: "ready",
    title: null,
    description: ("Label & https://example.com " + "x".repeat(400)).slice(
      0,
      300,
    ),
  });
  result.structuredContent.slack_data.channel_id = "C456";
  expect(nativeSlackResult(result, target)).toEqual({ status: "unavailable" });
});
it("validates profile identity and rejects duplicate or unexpected profile keys", () => {
  const target = nativeSlackTarget("https://team.slack.com/team/U123")!;
  const value = (result: string) => ({
    content: [{ type: "text", text: JSON.stringify({ result }) }],
  });
  expect(
    nativeSlackResult(
      value(
        "User ID: U123\nReal Name: Alice\nTitle: Engineer\nEmail: private@example.com",
      ),
      target,
    ),
  ).toEqual({ status: "ready", title: "Alice", description: "Engineer" });
  for (const result of [
    "User ID: U456\nReal Name: Alice",
    "User ID: U123\nReal Name: Alice\nReal Name: Bob",
    "User ID: U123\nReal Name: Alice\nSecret: bad",
  ])
    expect(nativeSlackResult(value(result), target)).toEqual({
      status: "unavailable",
    });
});
it("unwraps the actual Codex Apps tool-result envelope before matching profile data", () => {
  const target = nativeSlackTarget("https://team.slack.com/team/U123")!;
  const wrapped = {
    isError: false,
    structuredContent: {
      content: [
        {
          type: "text",
          text: JSON.stringify({ result: "User ID: U123\nReal Name: Alice" }),
        },
      ],
      isError: false,
      meta: null,
      structuredContent: null,
    },
  };
  expect(nativeSlackResult(wrapped, target)).toEqual({
    status: "ready",
    title: "Alice",
    description: null,
  });
  wrapped.structuredContent.isError = true;
  expect(nativeSlackResult(wrapped, target)).toEqual({ status: "unavailable" });
});
