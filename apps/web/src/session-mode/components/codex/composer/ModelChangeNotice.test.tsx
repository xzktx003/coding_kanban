import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import {
  hydrateThreadModel,
  changeThreadModel,
  useThreadModelStore,
} from "@session/stores/useThreadModelStore";
import { ModelChangeNotice } from "./ModelChangeNotice";
beforeEach(() => {
  useThreadModelStore.setState({ threads: {} });
});
it("shows the official v2 performance warning once and dismisses only the targeted thread", () => {
  for (const id of ["a", "b"]) {
    hydrateThreadModel(id, { model: "base" });
    changeThreadModel(id, { model: "next" });
  }
  const view = render(<ModelChangeNotice threadId="a" />);
  const text = screen.getByRole("status").textContent!;
  expect(text).toContain(
    "在对话中途更改模型会降低性能。为获得最佳体验，请开始新会话，或切换回 base。",
  );
  expect(text.match(/降低性能/g)).toHaveLength(1);
  expect(text).not.toContain("背景信息可能会自动压缩");
  fireEvent.click(screen.getByRole("button", { name: "关闭模型切换提示" }));
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(<ModelChangeNotice threadId="b" />);
  expect(screen.getByRole("status")).toBeTruthy();
});
