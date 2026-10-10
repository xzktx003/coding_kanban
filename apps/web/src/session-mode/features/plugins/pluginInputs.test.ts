import { beforeEach, expect, it } from "vitest";
import {
  pluginInputDrafts,
  pluginInputMention,
  usePluginInputDrafts,
} from "./pluginInputs";
beforeEach(() => usePluginInputDrafts.setState({ drafts: {} }));
it("keeps native plugin identity separate from label and rejects malformed path metadata", () => {
  expect(
    pluginInputMention({
      id: "fixture@market",
      name: "fixture",
      interface: { displayName: "Display Label" },
    } as never),
  ).toEqual({ name: "Display Label", path: "plugin://fixture@market" });
  expect(
    pluginInputMention({
      id: "../escape",
      name: "fixture",
      interface: null,
    } as never),
  ).toBeNull();
});
it("new-thread move preserves captured snapshot references so successful submit clears only that owner version", () => {
  pluginInputDrafts.add("draft:A", {
    name: "Fixture",
    path: "plugin://fixture@market",
  });
  const snapshot = pluginInputDrafts.read("draft:A", "@Fixture inspect");
  pluginInputDrafts.move("draft:A", "thread:A");
  pluginInputDrafts.clear("thread:A", snapshot);
  expect(pluginInputDrafts.read("thread:A")).toEqual([]);
  expect(pluginInputDrafts.read("draft:A")).toEqual([]);
});
it("a later identity addition with the same token survives an earlier delayed submit and B stays untouched", () => {
  pluginInputDrafts.add("A", {
    name: "Fixture",
    path: "plugin://fixture@market",
  });
  pluginInputDrafts.add("B", { name: "Other", path: "plugin://other@market" });
  const original = pluginInputDrafts.read("A", "@Fixture inspect");
  pluginInputDrafts.add("A", {
    name: "Fixture",
    path: "plugin://fixture@market",
  });
  pluginInputDrafts.clear("A", original);
  expect(pluginInputDrafts.read("A")).toHaveLength(1);
  expect(pluginInputDrafts.read("B")).toHaveLength(1);
  pluginInputDrafts.prune("A", "@Fixture-other is literal");
  expect(pluginInputDrafts.read("A")).toEqual([]);
});
