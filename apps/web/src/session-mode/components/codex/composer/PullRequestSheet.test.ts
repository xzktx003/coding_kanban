import { expect, it } from "vitest";
import {
  githubBranchPullsUrl,
  githubCompareUrl,
  githubMergeOptionsUrl,
} from "./PullRequestSheet";

it("builds a GitHub compare link for the current branch", () => {
  expect(
    githubCompareUrl(
      { owner: "fixture", repo: "fixture", branch: "feature/ui" },
      "界面",
      "说明",
    ),
  ).toBe(
    "https://github.com/fixture/fixture/compare/feature/ui?expand=1&title=%E7%95%8C%E9%9D%A2&body=%E8%AF%B4%E6%98%8E",
  );
});

it("builds a GitHub pulls search for merging the current branch", () => {
  expect(
    githubMergeOptionsUrl({
      owner: "fixture",
      repo: "fixture",
      branch: "feature/ui",
    }),
  ).toBe(
    "https://github.com/fixture/fixture/pulls?q=is%3Aopen+head%3Afeature%2Fui",
  );
});

it("builds a GitHub pulls search for the current branch", () => {
  expect(
    githubBranchPullsUrl({
      owner: "fixture",
      repo: "fixture",
      branch: "feature/ui",
    }),
  ).toBe("https://github.com/fixture/fixture/pulls?q=head%3Afeature%2Fui");
});
