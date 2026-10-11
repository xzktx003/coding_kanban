import { beforeEach, expect, it } from "vitest";
import {
  changeThreadModel,
  useThreadModelStore,
} from "./useThreadModelStore";

beforeEach(() => {
  useThreadModelStore.setState({ threads: {} });
});

it("records a local personality line without touching protocol events", () => {
  changeThreadModel("thread-a", { personality: "pragmatic" });
  expect(useThreadModelStore.getState().threads["thread-a"]?.personalityNotice).toEqual({
    personality: "pragmatic",
  });
  changeThreadModel("thread-a", { model: "gpt-test" });
  expect(useThreadModelStore.getState().threads["thread-a"]?.personalityNotice).toEqual({
    personality: "pragmatic",
  });
  changeThreadModel("thread-a", { personality: "friendly" });
  expect(useThreadModelStore.getState().threads["thread-a"]?.personalityNotice).toEqual({
    personality: "friendly",
  });
  changeThreadModel("thread-b", { personality: "pragmatic" });
  expect(useThreadModelStore.getState().threads["thread-a"]?.personalityNotice).toEqual({
    personality: "friendly",
  });
});
