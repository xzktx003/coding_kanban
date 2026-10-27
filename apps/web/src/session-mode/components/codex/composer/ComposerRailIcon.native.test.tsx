import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { ComposerRailIcon } from "./ComposerRailIcon";
import { NativeComposerIcon } from "./NativeComposerIcon";

it.each(["queue", "steer", "delete", "more"] as const)(
  "keeps %s SVG descendants on same-name parent/class updates",
  async (name) => {
    const view = render(
      <button>
        <ComposerRailIcon name={name} className="before" />
      </button>,
    );
    const svg = view.container.querySelector("svg")!;
    const children = [...svg.childNodes];
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(svg, { childList: true, subtree: true });
    try {
      for (const className of ["before", "after", "after"]) {
        view.rerender(
          <button>
            <ComposerRailIcon name={name} className={className} />
          </button>,
        );
        await Promise.resolve();
        expect(view.container.querySelector("svg")).toBe(svg);
        expect(
          [...svg.childNodes].every((child, i) => child === children[i]),
        ).toBe(true);
        expect(records).toHaveLength(0);
      }
    } finally {
      observer.disconnect();
    }
  },
);

it("keeps the existing native icon control stable and changes rail content only for a different name", async () => {
  const view = render(
    <>
      <ComposerRailIcon name="more" />
      <NativeComposerIcon name="more" />
    </>,
  );
  const [rail, control] = [...view.container.querySelectorAll("svg")];
  const oldRailPath = rail.querySelector("path"),
    oldControlPath = control.querySelector("path");
  view.rerender(
    <>
      <ComposerRailIcon name="queue" />
      <NativeComposerIcon name="more" className="after" />
    </>,
  );
  await Promise.resolve();
  expect(view.container.querySelectorAll("svg")[0]).toBe(rail);
  expect(rail.querySelector("path")).not.toBe(oldRailPath);
  expect(control.querySelector("path")).toBe(oldControlPath);
});
