import { fireEvent, render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ServerNotification } from "@session/bindings";
import { EventItem } from "./EventItem";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
it("does not serialize a collapsed protocol payload until the user expands it", () => {
  const toJSON = vi.fn(() => ({ result: "tool details" }));
  const { container } = render(
    <EventItem
      event={
        {
          method: "future/tool",
          params: { toJSON },
        } as unknown as ServerNotification
      }
    />,
  );
  expect(toJSON).not.toHaveBeenCalled();
  const details = container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(toJSON).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("tool details");
});
