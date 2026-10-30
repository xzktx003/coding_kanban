import { render, screen, waitFor } from "@testing-library/react";
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
    Array.from(rail.querySelectorAll("button"), (el) => el.textContent),
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
