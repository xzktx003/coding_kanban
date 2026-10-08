import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PricingEditor } from "./PricingEditor";
import { confirmSessionNavigation, requestSessionNavigation, useSessionNavigationGuard } from "@session/services/sessionNavigationGuard";
beforeEach(() => useSessionNavigationGuard.setState({ pending: null }));
it("protects typed pricing changes before blur, including an incomplete numeric edit", () => {
  render(<PricingEditor pricing={{ demo: { input: 1, output: 2, cache_read: 0, cache_creation: 0 } }} onClose={vi.fn()} onSave={vi.fn()} />);
  const input = screen.getByRole("spinbutton", { name: "demo 输入" });
  fireEvent.change(input, { target: { value: "" } });
  const leave = vi.fn();
  act(() => requestSessionNavigation(leave));
  expect(leave).not.toHaveBeenCalled();
  act(confirmSessionNavigation);
  expect(leave).toHaveBeenCalledOnce();
});
