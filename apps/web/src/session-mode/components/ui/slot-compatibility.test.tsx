import { createElement, type ElementType, type MouseEvent } from "react";
import { fireEvent, render } from "@testing-library/react";
import { expect, it } from "vitest";
import { Slot as AggregateSlot } from "radix-ui";
import * as DirectSlot from "@radix-ui/react-slot";
import { Button } from "./button";

function observeSlot(Root: ElementType, preventDefault: boolean) {
  const events: string[] = [], refs: string[] = [];
  const tree = render(createElement(Root, {
    ref: (node: HTMLElement | null) => { refs.push(`outer:${node?.tagName ?? "null"}`); },
    className: "outer", style: { color: "red", padding: "4px" },
    "aria-label": "inherited action", "data-outer": "retained",
    onClick: (event: MouseEvent) => events.push(`outer:${event.defaultPrevented}`),
  }, createElement("button", {
    ref: (node: HTMLButtonElement | null) => { refs.push(`child:${node?.tagName ?? "null"}`); },
    type: "button", className: "child", style: { color: "blue" },
    onClick: (event: MouseEvent) => { events.push("child"); if (preventDefault) event.preventDefault(); },
  }, "Run action")));
  const action = tree.getByRole("button", { name: "inherited action" });
  const attributes = Object.fromEntries([...action.attributes].map(({ name, value }) => [name, value]));
  fireEvent.click(action);
  tree.unmount();
  return { attributes, events, refs };
}

for (const preventDefault of [false, true])
  it(`keeps original Slot property, style, event and composed ref semantics with preventDefault=${preventDefault}`, () => {
    // The installed direct Slot is 1.2.4; the aggregate package used 1.2.3.
    // Context-free composition must preserve real observable behavior.
    const original = observeSlot(AggregateSlot.Root, preventDefault);
    const direct = observeSlot(DirectSlot.Root, preventDefault);
    expect(direct).toEqual(original);
    expect(direct.events).toEqual(["child", `outer:${preventDefault}`]);
    expect(direct.attributes.class).toBe("outer child");
    expect(direct.attributes.style).toContain("color: blue");
    expect(direct.refs).toEqual(expect.arrayContaining(["outer:BUTTON", "child:BUTTON", "outer:null", "child:null"]));
  });

it("actual asChild Button keeps a single native target, child attributes and both handlers", () => {
  const events: string[] = [], form = render(<Button asChild aria-label="Open exact target" onClick={() => events.push("outer")}>
    <a href="#exact-target" data-target="captured" onClick={(event) => { event.preventDefault(); events.push("child"); }}>Open</a>
  </Button>);
  const link = form.getByRole("link", { name: "Open exact target" });
  fireEvent.click(link);
  expect(form.container.querySelectorAll("button,a")).toHaveLength(1);
  expect(link.getAttribute("href")).toBe("#exact-target");
  expect(link.getAttribute("data-target")).toBe("captured");
  expect(link.getAttribute("data-slot")).toBe("button");
  expect(events).toEqual(["child", "outer"]);
});
