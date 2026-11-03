import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ComposerRail, ComposerRailItem } from "./ComposerRail";

const motionPreference = vi.hoisted(() => ({ reduced: false }));

beforeEach(() => {
  motionPreference.reduced = false;
  vi.spyOn(window, "matchMedia").mockImplementation(query => ({ media: query, get matches() { return motionPreference.reduced; }, onchange: null, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: () => true }));
});

function Fixture({ changes = true, queue = true }) {
  return (
    <ComposerRail>
      <ComposerRailItem visible={changes}>
        <button>查看变更</button>
      </ComposerRailItem>
      <ComposerRailItem visible={queue}>
        <button>编辑排队消息</button>
      </ComposerRailItem>
    </ComposerRail>
  );
}

it("keeps changes and the queue together in an attached rail, without empty items", () => {
  const view = render(<Fixture changes={false} />);
  const rail = view.container.querySelector("[data-composer-rail]")!;
  expect(rail.getAttribute("data-composer-rail-placement")).toBe("above");
  expect(rail.querySelectorAll("[data-composer-rail-item]")).toHaveLength(1);
  view.rerender(<Fixture />);
  expect(
    Array.from(rail.querySelectorAll("[data-composer-rail-item] button"), (el) => el.textContent),
  ).toEqual(["查看变更", "编辑排队消息"]);
});

it("makes exiting content inert immediately and removes it after the transition", async () => {
  const view = render(<Fixture />);
  const queue = screen.getByRole("button", { name: "编辑排队消息" });
  view.rerender(<Fixture queue={false} />);
  const exiting = queue.closest("[data-composer-rail-item]")!;
  expect(exiting.getAttribute("data-composer-rail-item")).toBe("exiting");
  expect(exiting.hasAttribute("inert")).toBe(true);
  expect(exiting.getAttribute("aria-hidden")).toBe("true");
  await waitFor(() => expect(queue.isConnected).toBe(false));
  expect(screen.getByRole("button", { name: "查看变更" })).toBeTruthy();
});

it("does not retain hidden controls when reduced motion is requested", async () => {
  motionPreference.reduced = true;
  const view = render(<Fixture />);
  expect(
    view.container
      .querySelector("[data-composer-rail]")
      ?.getAttribute("data-reduced-motion"),
  ).toBe("true");
  view.rerender(<Fixture changes={false} queue={false} />);
  await waitFor(() =>
    expect(
      view.container.querySelector("[data-composer-rail-item]"),
    ).toBeNull(),
  );
});

it("collapses per owner, retains the reopen control, and resets after all notices disappear", async () => {
  const rail = (owner: string, visible: boolean) => (
    <ComposerRail owner={owner} key={owner}>
      <ComposerRailItem visible={visible}><button>待处理事项</button></ComposerRailItem>
    </ComposerRail>
  );
  const view = render(rail("collapse-test-a", true));
  fireEvent.click(screen.getByRole("button", { name: "收起提示" }));
  expect(screen.queryByRole("button", { name: "待处理事项" })).toBeNull();
  expect(screen.getByRole("button", { name: "展开提示" }).getAttribute("aria-expanded")).toBe("false");
  view.rerender(rail("collapse-test-b", true));
  expect(screen.getByRole("button", { name: "待处理事项" })).toBeTruthy();
  view.rerender(rail("collapse-test-a", true));
  expect(screen.getByRole("button", { name: "展开提示" })).toBeTruthy();
  view.rerender(rail("collapse-test-a", false));
  await waitFor(() => expect(screen.queryByRole("button", { name: "展开提示" })).toBeNull());
  view.rerender(rail("collapse-test-a", true));
  await waitFor(() => expect(screen.getByRole("button", { name: "待处理事项" })).toBeTruthy());
});

it("keeps status actions and the delivery summary available while collapsed", () => {
  render(
    <ComposerRail owner="collapse-status-test" status={<span role="alert">需要核对 <button>重新核对</button></span>} collapsedSummary="消息发送结果待核对">
      <ComposerRailItem visible><button>队列详情</button></ComposerRailItem>
    </ComposerRail>,
  );
  fireEvent.click(screen.getByRole("button", { name: "收起提示" }));
  expect(screen.getByRole("alert").textContent).toContain("需要核对");
  expect(screen.getByRole("button", { name: "重新核对" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("消息发送结果待核对");
});

it("uses a quiet icon next to the status and keeps an identifiable reopen action", () => {
  const view = render(
    <ComposerRail owner="quiet-toggle-test" status={<span className="session-native-composer-status">已达成目标</span>}>
      <ComposerRailItem visible><span>目标内容</span></ComposerRailItem>
    </ComposerRail>,
  );
  const toggle = screen.getByRole("button", { name: "收起提示" });
  expect(toggle.textContent).toBe("");
  expect(toggle.getAttribute("title")).toBe("收起提示");
  expect(view.container.querySelector(".session-composer-rail-header")?.lastElementChild).toBe(toggle);
  fireEvent.click(toggle);
  const reopen = screen.getByRole("button", { name: "展开提示" });
  expect(reopen.textContent).toBe("展开");
  expect(reopen.getAttribute("title")).toBe("展开提示");
});

it("does not discard a collapsed owner while its notices are temporarily unavailable on remount", async () => {
  const rail = (owner: string, visible: boolean) => (
    <ComposerRail owner={owner} key={owner}>
      <ComposerRailItem visible={visible}><button>延迟恢复的提示</button></ComposerRailItem>
    </ComposerRail>
  );
  const view = render(rail("restore-test-a", true));
  fireEvent.click(screen.getByRole("button", { name: "收起提示" }));
  view.rerender(rail("restore-test-b", true));
  view.rerender(rail("restore-test-a", false));
  view.rerender(rail("restore-test-a", true));
  await waitFor(() => expect(screen.getByRole("button", { name: "展开提示" })).toBeTruthy());
  expect(screen.queryByRole("button", { name: "延迟恢复的提示" })).toBeNull();
});
