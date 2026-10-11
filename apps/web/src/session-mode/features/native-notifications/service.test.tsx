import { afterEach, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
const transport = vi.hoisted(() => ({ custom: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast: transport }));
import { createNativeNotifications } from "./service";
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
it("queues until a viewport exists and finalizes replaced logical IDs exactly once", () => {
  const service = createNativeNotifications("test"),
    removed = vi.fn();
  const old = service.info("first", { id: "job", onRemove: removed });
  service.info("replacement", { id: "job", duration: 0 });
  expect(removed).toHaveBeenCalledTimes(1);
  old.close();
  expect(removed).toHaveBeenCalledTimes(1);
  expect(transport.custom).not.toHaveBeenCalled();
  service.registerViewport();
  expect(transport.custom).toHaveBeenCalledTimes(1);
  expect(transport.custom.mock.calls[0][1]).toMatchObject({
    duration: Infinity,
    toasterId: "test",
  });
  service.closeAll();
});
it("passes five second expiry and cleans both explicit and automatic removal", () => {
  const service = createNativeNotifications("test"),
    removed = vi.fn();
  service.registerViewport();
  const handle = service.danger("error", { onRemove: removed });
  const options = transport.custom.mock.calls[0][1];
  expect(options.duration).toBe(5000);
  options.onAutoClose();
  handle.close();
  options.onDismiss();
  expect(removed).toHaveBeenCalledTimes(1);
});
it("success without actions has an independent wall clock and releases it on unmount", async () => {
  vi.useFakeTimers();
  const service = createNativeNotifications("test"),
    removed = vi.fn();
  service.registerViewport();
  service.success("done", { duration: 1, onRemove: removed });
  const view = render(transport.custom.mock.calls[0][0]());
  act(() => vi.advanceTimersByTime(1000));
  expect(removed).toHaveBeenCalledTimes(1);
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(removed).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not start a second success timer when a primary action exists", async () => {
  vi.useFakeTimers();
  const service = createNativeNotifications("test"),
    removed = vi.fn();
  service.registerViewport();
  service.success("done", {
    primaryAction: { label: "view", onClick: vi.fn() },
    onRemove: removed,
  });
  const view = render(transport.custom.mock.calls[0][0]());
  act(() => vi.advanceTimersByTime(6000));
  expect(removed).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(removed).toHaveBeenCalledTimes(1);
});
it("custom content distinguishes user swipe from programmatic, replacement and automatic removal", () => {
  const service = createNativeNotifications("custom"),
    user = vi.fn(),
    removed = vi.fn(),
    content = vi.fn(() => <button>Reconnect</button>);
  service.registerViewport();
  const a = service.custom({
    id: "auth",
    level: "warning",
    content,
    onUserDismiss: user,
    onRemove: removed,
  });
  expect(content).toHaveBeenCalledWith({
    close: expect.any(Function),
    level: "warning",
  });
  a.close();
  transport.custom.mock.calls.at(-1)![1].onDismiss();
  expect(user).not.toHaveBeenCalled();
  expect(removed).toHaveBeenCalledTimes(1);
  service.custom({ content, onUserDismiss: user, onRemove: removed });
  const options = transport.custom.mock.calls.at(-1)![1];
  options.onDismiss();
  options.onDismiss();
  expect(user).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledTimes(2);
  service.custom({ content, onUserDismiss: user, onRemove: removed });
  transport.custom.mock.calls.at(-1)![1].onAutoClose();
  expect(user).toHaveBeenCalledTimes(1);
  expect(removed).toHaveBeenCalledTimes(3);
});
it("a success-level custom notice delegates expiry to Sonner and releases content on unmount", async () => {
  vi.useFakeTimers();
  const service = createNativeNotifications("custom"),
    removed = vi.fn();
  service.registerViewport();
  service.custom({
    level: "success",
    duration: 1,
    content: () => <span>custom</span>,
    onRemove: removed,
  });
  const view = render(transport.custom.mock.calls[0][0]());
  act(() => vi.advanceTimersByTime(2000));
  expect(removed).not.toHaveBeenCalled();
  view.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  expect(removed).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
