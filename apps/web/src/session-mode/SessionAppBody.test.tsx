import { afterEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import React, { type PropsWithChildren } from "react";

const loader = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./sessionWorkbenchLoader", () => ({
  loadSessionApp: loader.load,
}));

import { SessionAppBody } from "./SessionAppBody";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.resetAllMocks();
});

it("shows the loading shell until the shared App import resolves", async () => {
  const pending = deferred<{ default: () => React.ReactElement }>();
  loader.load.mockReturnValue(pending.promise);
  const view = render(<SessionAppBody />);
  expect(screen.getByRole("status").textContent).toContain("正在准备会话内容");

  await act(async () => {
    pending.resolve({
      default: () => <textarea aria-label="会话草稿" defaultValue="draft" />,
    });
    await pending.promise;
  });
  const draft = screen.getByLabelText("会话草稿") as HTMLTextAreaElement;
  fireEvent.change(draft, { target: { value: "edited draft" } });
  view.rerender(<SessionAppBody />);
  expect(screen.getByLabelText("会话草稿")).toBe(draft);
  expect(draft.value).toBe("edited draft");
  expect(loader.load).toHaveBeenCalledOnce();
});

it("renders an already resolved shared import without suspending", async () => {
  loader.load.mockResolvedValue({
    default: () => <div>预加载完成</div>,
  });
  render(<SessionAppBody />);
  expect(await screen.findByText("预加载完成")).toBeTruthy();
});

it("rethrows import errors to the surrounding error boundary", async () => {
  const pending = deferred<{ default: () => React.ReactElement }>();
  loader.load.mockReturnValue(pending.promise);
  const Boundary = ({ children }: PropsWithChildren) => {
    return <ErrorBoundary>{children}</ErrorBoundary>;
  };
  class ErrorBoundary extends React.Component<
    PropsWithChildren,
    { failed: boolean }
  > {
    state = { failed: false };
    static getDerivedStateFromError() {
      return { failed: true };
    }
    render() {
      return this.state.failed ? (
        <div role="alert">已捕获加载错误</div>
      ) : (
        this.props.children
      );
    }
  }

  render(
    <Boundary>
      <SessionAppBody />
    </Boundary>,
  );
  await act(async () => {
    pending.reject(new Error("import failed"));
    await pending.promise.catch(() => undefined);
  });
  expect(screen.getByRole("alert").textContent).toContain("已捕获加载错误");
});

it("ignores a settled import after unmount", async () => {
  const pending = deferred<{ default: () => React.ReactElement }>();
  loader.load.mockReturnValue(pending.promise);
  const { unmount, container } = render(<SessionAppBody />);
  unmount();
  await act(async () => {
    pending.resolve({ default: () => <div>too late</div> });
    await pending.promise;
  });
  expect(container.textContent).toBe("");
});
