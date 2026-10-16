import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionProjectLabel } from "./SessionIdentity";

const fixtures = vi.hoisted(() => ({
  toast: vi.fn(),
  state: { cards: [], detachedCard: null },
}));
vi.mock("../ui/use-toast", () => ({ toast: fixtures.toast }));
vi.mock("../common/SessionAgentBadge", () => ({
  SessionAgentBadge: () => null,
}));
vi.mock("../../stores/useAgentCenterStore", () => ({
  useAgentCenterStore: (selector: (state: unknown) => unknown) =>
    selector(fixtures.state),
}));
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
const path = "/fixture/项目/exact working directory";
let legacy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fixtures.toast.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: undefined,
  });
  legacy = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: legacy,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  if (execDescriptor)
    Object.defineProperty(document, "execCommand", execDescriptor);
  else delete (document as { execCommand?: unknown }).execCommand;
});

async function copyProject() {
  fireEvent.keyDown(screen.getByRole("button", { name: /^项目详情：/ }), {
    key: "ArrowDown",
  });
  const item = await screen.findByRole("menuitem", { name: "复制项目路径" });
  await act(async () => fireEvent.click(item));
}

it("copies the actual project path over HTTP without selecting, locating or navigating", async () => {
  let copied = "";
  legacy.mockImplementation(() => {
    const textarea = document.querySelector("textarea")!;
    copied = textarea.value;
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(path.length);
    return true;
  });
  const parentClick = vi.fn(),
    open = vi.fn(),
    reveal = vi.fn();
  window.addEventListener("session-open-projects", open);
  window.addEventListener("session-reveal-project", reveal);
  const location = window.location.href;
  try {
    render(
      <div onClick={parentClick}>
        <SessionProjectLabel card={{ cwd: path }} />
      </div>,
    );
    await copyProject();
    expect(copied).toBe(path);
    expect(legacy).toHaveBeenCalledExactlyOnceWith("copy");
    expect(fixtures.toast).not.toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(window.location.href).toBe(location);
    expect(document.querySelector("textarea")).toBeNull();
  } finally {
    window.removeEventListener("session-open-projects", open);
    window.removeEventListener("session-reveal-project", reveal);
  }
});

it("provides the full copy-event payload when the modal keeps focus away from the fallback textarea", async () => {
  const previousUrl = "http://fixture.invalid/?mode=session";
  let clipboardValue = previousUrl;
  const observed: Array<{
    activeTag: string | undefined;
    prevented: boolean;
    plain: string | undefined;
  }> = [];
  legacy.mockImplementation(() => {
    // Reproduce the real browser's DIV focus and empty default selection:
    // execCommand can return true while leaving the previous clipboard untouched.
    screen.getByRole("menu").focus();
    const data = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (kind: string, value: string) => data.set(kind, value),
      },
    });
    document.activeElement!.dispatchEvent(event);
    observed.push({
      activeTag: document.activeElement?.tagName,
      prevented: event.defaultPrevented,
      plain: data.get("text/plain"),
    });
    if (event.defaultPrevented && data.has("text/plain"))
      clipboardValue = data.get("text/plain")!;
    return true;
  });
  render(<SessionProjectLabel card={{ cwd: path }} />);
  await copyProject();
  expect(observed).toEqual([
    { activeTag: "DIV", prevented: true, plain: path },
  ]);
  expect(clipboardValue).toBe(path);
  expect(clipboardValue).not.toBe(previousUrl);
  expect(fixtures.toast).not.toHaveBeenCalled();
});

it("admits only one project copy while browser permission is pending", async () => {
  let resolve!: () => void;
  const writeText = vi.fn(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<SessionProjectLabel card={{ cwd: path }} />);
  await copyProject();
  await copyProject();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(path);
  await act(async () => resolve());
  expect(fixtures.toast).not.toHaveBeenCalled();
});

for (const settlement of ["resolve", "reject"] as const)
  it(`ignores old-project ${settlement} feedback after the project path changes`, async () => {
    let resolve!: () => void, reject!: (reason: Error) => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    legacy.mockReturnValue(false);
    const view = render(<SessionProjectLabel card={{ cwd: path }} />);
    await copyProject();
    const nextPath = "/fixture/next project";
    view.rerender(<SessionProjectLabel card={{ cwd: nextPath }} />);
    await act(async () =>
      settlement === "resolve"
        ? resolve()
        : reject(new Error("fixture old project")),
    );
    expect(fixtures.toast).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
    writeText.mockResolvedValueOnce(undefined);
    await copyProject();
    expect(writeText).toHaveBeenLastCalledWith(nextPath);
  });

for (const settlement of ["resolve", "reject"] as const)
  it(`does not report or retry a project write that ${settlement}s after unmount`, async () => {
    let resolve!: () => void, reject!: (reason: Error) => void;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((done, fail) => {
            resolve = done;
            reject = fail;
          }),
      },
    });
    legacy.mockReturnValue(false);
    const view = render(<SessionProjectLabel card={{ cwd: path }} />);
    await copyProject();
    view.unmount();
    await act(async () =>
      settlement === "resolve"
        ? resolve()
        : reject(new Error("fixture detached")),
    );
    expect(fixtures.toast).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

it("does not report an old card failure when a different card has the same project path", async () => {
  let reject!: (reason: Error) => void;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: () =>
        new Promise<void>((_done, fail) => {
          reject = fail;
        }),
    },
  });
  legacy.mockReturnValue(false);
  const firstCard = { cwd: path, id: "fixture-source-one" };
  const secondCard = { cwd: path, id: "fixture-source-two" };
  const view = render(<SessionProjectLabel card={firstCard} />);
  await copyProject();
  view.rerender(<SessionProjectLabel card={secondCard} />);
  await act(async () => reject(new Error("fixture old card")));
  expect(fixtures.toast).not.toHaveBeenCalled();
  expect(legacy).not.toHaveBeenCalled();
});

for (const failure of ["legacy-false", "modern-reject"] as const)
  it(`reports both consecutive ${failure} operations without a boolean effect latch`, async () => {
    legacy.mockReturnValue(false);
    if (failure === "modern-reject")
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: vi.fn().mockRejectedValue(new Error("fixture denied")),
        },
      });
    render(<SessionProjectLabel card={{ cwd: path }} />);
    await copyProject();
    await copyProject();
    expect(fixtures.toast).toHaveBeenCalledTimes(2);
    for (const [notice] of fixtures.toast.mock.calls)
      expect(notice).toEqual({
        title: "复制失败",
        description: "请从项目详情中选择并复制完整路径。",
        variant: "destructive",
      });
  });

for (const failure of ["legacy-false", "modern-reject"] as const)
  it(`keeps the manual-copy failure toast for ${failure}`, async () => {
    legacy.mockReturnValue(false);
    if (failure === "modern-reject")
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: vi.fn().mockRejectedValue(new Error("fixture denied")),
        },
      });
    render(<SessionProjectLabel card={{ cwd: path }} />);
    await copyProject();
    expect(fixtures.toast).toHaveBeenCalledExactlyOnceWith({
      title: "复制失败",
      description: "请从项目详情中选择并复制完整路径。",
      variant: "destructive",
    });
    if (failure === "legacy-false")
      expect(legacy).toHaveBeenCalledExactlyOnceWith("copy");
    else expect(legacy).not.toHaveBeenCalled();
  });

it("does not issue a copy or navigate for a project with no path", async () => {
  render(<SessionProjectLabel card={{}} />);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "项目详情：项目未知" }),
    { key: "ArrowDown" },
  );
  expect(
    await screen.findByText("项目未知：这条会话尚无项目目录，请先确认项目。"),
  ).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "复制项目路径" })).toBeNull();
  expect(legacy).not.toHaveBeenCalled();
});
