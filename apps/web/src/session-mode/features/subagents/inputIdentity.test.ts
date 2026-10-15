import { expect, it } from "vitest";
import { selectCodexThreadInput } from "./inputIdentity";
import type { SubagentNode } from "./model";
const candidate: SubagentNode = {
  thread: { id: "root" },
  parentId: "child",
  verified: false,
  revision: 1,
};
it("current main metadata wins over an old observation entry", () => {
  expect(
    selectCodexThreadInput(
      { id: "root", source: "vscode", parentThreadId: null },
      candidate,
      undefined,
      0,
    ),
  ).toMatchObject({ kind: "main", blocked: false, needsVerification: false });
});
it("an unverified creation or migrated cache is unknown rather than a confirmed managed child", () => {
  expect(
    selectCodexThreadInput(
      undefined,
      { ...candidate, thread: { id: "root", canAcceptDirectInput: true } },
      undefined,
      0,
    ),
  ).toMatchObject({ kind: "unknown", blocked: true, needsVerification: true });
});
it.each([false, null, undefined, true])(
  "native child permission %s is used literally",
  (canAcceptDirectInput) => {
    const thread = {
      id: "child",
      parentThreadId: "root",
      canAcceptDirectInput,
    };
    expect(
      selectCodexThreadInput(
        thread,
        undefined,
        { thread, revision: 1, runtimeEpoch: 0 },
        0,
      ),
    ).toMatchObject({
      kind: "child",
      blocked: canAcceptDirectInput !== true,
      needsVerification: canAcceptDirectInput == null,
    });
  },
);
it("a subagent source without its parent remains a child requiring native capability", () => {
  expect(
    selectCodexThreadInput(
      {
        id: "child",
        source: { subAgent: {} },
        parentThreadId: null,
        canAcceptDirectInput: true,
      },
      undefined,
      undefined,
      0,
    ),
  ).toMatchObject({ kind: "child", blocked: true, needsVerification: true });
});
it("previous-runtime permission cannot reopen a child, including a stale native thread list", () => {
  const thread = {
    id: "child",
    parentThreadId: "root",
    canAcceptDirectInput: true,
  };
  expect(
    selectCodexThreadInput(
      thread,
      undefined,
      { thread, revision: 1, runtimeEpoch: 0 },
      1,
    ),
  ).toMatchObject({ blocked: true, needsVerification: true });
});
it("an unavailable child cannot use a last-known capability", () => {
  const thread = {
    id: "child",
    parentThreadId: "root",
    canAcceptDirectInput: true,
  };
  expect(
    selectCodexThreadInput(
      thread,
      { ...candidate, thread, verified: true, unavailable: true },
      { thread, revision: 1, runtimeEpoch: 0 },
      0,
    ),
  ).toMatchObject({ blocked: true, needsVerification: true });
});
it("source-less legacy main metadata remains compatible without claiming main identity", () => {
  expect(
    selectCodexThreadInput(
      { id: "old-main", parentThreadId: null },
      undefined,
      undefined,
      0,
    ),
  ).toMatchObject({
    kind: "unknown",
    blocked: false,
    needsVerification: false,
  });
});
