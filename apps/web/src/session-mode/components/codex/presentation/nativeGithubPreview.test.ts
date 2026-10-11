import { expect, it } from "vitest";
import {
  nativeGithubPullRequest,
  nativeGithubResult,
} from "@agent-orchestrator/shared";
const target = {
  hostname: "github.com",
  owner: "OpenAI",
  repository: "Codex",
  number: 42,
};
const info = {
  base: "main",
  head: "fix",
  draft: false,
  merged: false,
  number: 42,
  state: "OPEN",
  title: "Fix reply routing",
  url: "https://github.com/openai/codex/pull/42",
};
it("recognizes only native GitHub PR targets, including trailing paths and leading zeroes", () => {
  expect(
    nativeGithubPullRequest(
      "https://github.com/OpenAI/Codex/pull/00042/files?q=1",
    ),
  ).toEqual(target);
  expect(
    nativeGithubPullRequest("https://github.com/OpenAI/%43odex/pull/42"),
  ).toEqual(target);
  for (const href of [
    "http://github.com/a/b/pull/1",
    "https://user@github.com/a/b/pull/1",
    "https://github.com.evil/a/b/pull/1",
    "https://github.com/a/b/pull/%31",
    "https://github.com/a/b/pull/0",
    "https://github.com/a/b/pull/9007199254740992",
    "https://github.com/a/b/issues/1",
    "https://github.com/a%2fb/c/pull/1",
  ])
    expect(nativeGithubPullRequest(href)).toBeNull();
});
it.each([
  [{}, "open"],
  [{ draft: true }, "draft"],
  [{ state: "closed", draft: true }, "closed"],
  [{ merged: true, state: "closed" }, "merged"],
  [{ state: "MERGED" }, "merged"],
])("uses native lifecycle precedence %j", (fields, status) => {
  expect(
    nativeGithubResult({ structuredContent: { ...info, ...fields } }, target),
  ).toEqual({ title: info.title, status });
});
it("rejects malformed schema, mismatched numbers/URLs and tool errors", () => {
  for (const fields of [
    { number: 43 },
    { url: "https://github.com/other/codex/pull/42" },
    { state: "pending" },
    { draft: "false" },
    { head: null },
    { user: { login: "" } },
    { additions: -1 },
    { requested_reviewers: [7] },
  ])
    expect(
      nativeGithubResult({ structuredContent: { ...info, ...fields } }, target),
    ).toBeNull();
  expect(
    nativeGithubResult({ isError: true, structuredContent: info }, target),
  ).toBeNull();
  expect(
    nativeGithubResult(
      { content: [{ type: "text", text: JSON.stringify(info) }] },
      target,
    ),
  ).toBeNull();
});
it("validates the preferred fetch REST payload without keeping its body", () => {
  const rest = {
    ...info,
    base: { ref: "main" },
    head: { ref: "fix", sha: "abc", repo: null },
    html_url: info.url,
    body: "x".repeat(500_000),
  };
  expect(
    nativeGithubResult(
      { structuredContent: { content: JSON.stringify(rest) } },
      target,
      "fetch",
    ),
  ).toEqual({ title: info.title, status: "open" });
  expect(
    nativeGithubResult(
      {
        structuredContent: {
          content: JSON.stringify({ ...rest, head: { ref: "fix" } }),
        },
      },
      target,
      "fetch",
    ),
  ).toBeNull();
});
it("unwraps native Codex Apps tool envelopes before validating PR info", () => {
  expect(
    nativeGithubResult(
      {
        isError: false,
        structuredContent: {
          isError: false,
          content: [],
          structuredContent: info,
        },
      },
      target,
    ),
  ).toEqual({ title: info.title, status: "open" });
  expect(
    nativeGithubResult(
      {
        isError: false,
        structuredContent: {
          isError: true,
          content: [],
          structuredContent: info,
        },
      },
      target,
    ),
  ).toBeNull();
});
