import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerTooltip } from "./ComposerTooltip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@session/components/ui/tooltip";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { try { cleanup(); } finally { vi.restoreAllMocks(); vi.useRealTimers(); } });
const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function mouse(node: HTMLElement, type: "pointermove" | "pointerover" | "pointerout", relatedTarget: EventTarget | null = null, pointerType = "mouse") {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(node, event); return event;
}
const trigger = () => screen.getByRole("button", { name: "原附加按钮" });
const outside = () => screen.getByRole("button", { name: "外部焦点" });
function view(popupOpen = false, key = "same") {
  return <><ComposerTooltip label="附加文件" shortcut="@" popupOpen={popupOpen}>
    <button key={key} type="button" aria-label="原附加按钮" data-original="kept">按钮正文</button>
  </ComposerTooltip><button type="button">外部焦点</button></>;
}
function shown(node: HTMLElement, label = "附加文件") {
  const id = node.getAttribute("aria-describedby");
  if (!id || /\s/.test(id)) throw Error("Positive hint must have one actual native description ID");
  const matches = [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((element) => element.id === id);
  expect(matches).toHaveLength(1);
  const root = matches[0]?.closest<HTMLElement>('[data-slot="tooltip-content"]');
  if (!root) throw Error("Native description must belong to actual Content");
  expect(root.isConnected).toBe(true);
  const direct = root.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label");
  if (!direct) throw Error("Actual direct visible-label child missing; hidden role clone is not the label");
  expect(direct.childNodes[0]?.textContent).toBe(label);
  return { root, id, direct };
}
function gone(node: HTMLElement, previous?: ReturnType<typeof shown>) {
  expect(node.getAttribute("aria-describedby")).toBeNull();
  expect(document.querySelectorAll('.session-native-composer-tooltip[data-slot="tooltip-content"]')).toHaveLength(0);
  if (previous) { expect(previous.root.isConnected).toBe(false); expect(document.getElementById(previous.id)).toBeNull(); }
}
const leave = (node: HTMLElement) => mouse(node, "pointerout", outside());

it("C01 shown ordinary hint loses actual Content and owned ARIA on one trigger leave", async () => {
  render(view()); const node = trigger(); mouse(node, "pointerover"); mouse(node, "pointermove"); await tick(200);
  const positive = shown(node); expect(positive.direct.querySelector("kbd")?.textContent).toBe("@");
  expect(leave(node).defaultPrevented).toBe(false);
  gone(node, positive); await tick(351); gone(node, positive);
});

it("C02 pending leave at 199ms cancels the old request without granting a fast window", async () => {
  render(view()); const node = trigger(); mouse(node, "pointermove"); await tick(199); gone(node);
  leave(node); await tick(1); gone(node); await tick(400); gone(node);
  mouse(node, "pointerover"); mouse(node, "pointermove"); await tick(199); gone(node);
  await tick(1); shown(node);
});

it("C03 leave closes a genuinely focused hint without moving focus or spontaneous resurrection", async () => {
  render(view()); const node = trigger(); let focuses = 0, blurs = 0;
  const focus = () => { focuses++; }, blur = () => { blurs++; };
  node.addEventListener("focus", focus); node.addEventListener("blur", blur);
  try {
    act(() => node.focus()); const positive = shown(node); expect(document.activeElement).toBe(node);
    mouse(node, "pointerover"); leave(node); gone(node, positive);
    await tick(351); gone(node, positive); expect(document.activeElement).toBe(node); expect({ focuses, blurs }).toEqual({ focuses: 1, blurs: 0 });
  } finally { node.removeEventListener("focus", focus); node.removeEventListener("blur", blur); }
});

it("C04 fresh real blur and focus reopen on the same Button with original ref props and action intact", async () => {
  const ref = createRef<HTMLButtonElement>(); const clicks: boolean[] = [];
  render(<><ComposerTooltip label="附加文件"><button ref={ref} type="button" aria-label="原附加按钮" data-original="kept" onClick={(event) => clicks.push(event.defaultPrevented)}>按钮正文</button></ComposerTooltip><button type="button">外部焦点</button></>);
  const node = trigger(); act(() => node.focus()); const first = shown(node); leave(node); gone(node, first);
  act(() => outside().focus()); expect(document.activeElement).toBe(outside()); act(() => node.focus()); shown(node);
  expect(trigger()).toBe(node); expect(ref.current).toBe(node); expect(node.getAttribute("data-original")).toBe("kept");
  expect(node.getAttribute("aria-label")).toBe("原附加按钮"); expect(node.textContent).toBe("按钮正文");
  fireEvent.click(node); expect(clicks).toEqual([false]); expect(ref.current).toBe(node);
});

it("C05 an actual leave close retains the existing bounded 300ms fast reentry window", async () => {
  render(view()); const node = trigger(); act(() => node.focus()); const first = shown(node); leave(node); gone(node, first);
  await tick(299); mouse(node, "pointerover"); mouse(node, "pointermove"); await tick(0); shown(node);
});

it("C06 repeated leave while already closed cannot extend the original skip deadline", async () => {
  render(view()); const node = trigger(); act(() => node.focus()); const first = shown(node); leave(node); gone(node, first);
  await tick(200); leave(node); await tick(101);
  mouse(node, "pointerover"); mouse(node, "pointermove"); await tick(199); gone(node); await tick(1); shown(node);
});

it("C07 expiry of the leave-close window restores the complete cold 200ms delay", async () => {
  render(view()); const node = trigger(); act(() => node.focus()); const first = shown(node); leave(node); gone(node, first);
  await tick(300); mouse(node, "pointerover"); mouse(node, "pointermove"); await tick(199); gone(node); await tick(1); shown(node);
});

it("C08 a child-prevented leave preserves authority and does not consume the native action", async () => {
  let leaves = 0, clicks = 0;
  render(<><ComposerTooltip label="附加文件"><button type="button" aria-label="原附加按钮" onPointerLeave={(event) => { leaves++; event.preventDefault(); }} onClick={() => { clicks++; }}>按钮正文</button></ComposerTooltip><button type="button">外部焦点</button></>);
  const node = trigger(); act(() => node.focus()); const first = shown(node);
  expect(leave(node).defaultPrevented).toBe(true); expect(leaves).toBe(1); expect(shown(node).root).toBe(first.root);
  fireEvent.click(node); expect(clicks).toBe(1);
});

it("C09 movement between real children inside one Button is not a trigger leave", async () => {
  render(<><ComposerTooltip label="附加文件"><button type="button" aria-label="原附加按钮"><span data-part="a">左</span><span data-part="b">右</span></button></ComposerTooltip><button type="button">外部焦点</button></>);
  const node = trigger(), a = node.querySelector<HTMLElement>('[data-part="a"]'), b = node.querySelector<HTMLElement>('[data-part="b"]');
  if (!a || !b) throw Error("Real nested child controls missing");
  act(() => node.focus()); const first = shown(node); mouse(a, "pointerout", b); mouse(b, "pointerover", a);
  expect(shown(node).root).toBe(first.root); expect(document.activeElement).toBe(node);
});

it("C10 touch hover stays inert and does not create a skip window", async () => {
  render(view()); const node = trigger(); mouse(node, "pointerover", null, "touch"); mouse(node, "pointermove", null, "touch"); await tick(500); gone(node);
  mouse(node, "pointerover"); mouse(node, "pointermove"); await tick(199); gone(node); await tick(1); shown(node);
});

it("C11 popup suppression and release never revive the old focused or pending request", async () => {
  const host = render(view()); const node = trigger(); act(() => node.focus()); shown(node);
  host.rerender(view(true)); gone(node); leave(node); host.rerender(view(false)); await tick(500); gone(node);
  expect(trigger()).toBe(node); expect(document.activeElement).toBe(node);
  act(() => outside().focus()); act(() => node.focus()); shown(node);
});

it("C12 detached former-node events cannot dismiss the replacement hint (synthetic adapter defense only)", async () => {
  const host = render(view()); const old = trigger(); act(() => old.focus()); shown(old);
  host.rerender(view(false, "replacement")); await tick(0); const next = trigger(); expect(next).not.toBe(old); expect(old.isConnected).toBe(false);
  act(() => next.focus()); const positive = shown(next); mouse(old, "pointerout", outside()); await tick(0);
  expect(shown(next).root).toBe(positive.root); expect(document.activeElement).toBe(next);
});

it("C13 Common leave preserves real raw-Radix peer interoperability and fresh input", async () => {
  function Peer() { const [open, setOpen] = useState(false); return <TooltipProvider delayDuration={200}><Tooltip open={open} onOpenChange={setOpen}>
    <TooltipTrigger asChild><button type="button">真实 peer</button></TooltipTrigger><TooltipContent className="raw-peer"><span>peer 正文</span></TooltipContent>
  </Tooltip></TooltipProvider>; }
  render(<><Peer />{view()}</>); const node = trigger(), peer = screen.getByRole("button", { name: "真实 peer" });
  act(() => peer.focus()); expect(peer.getAttribute("aria-describedby")).toMatch(/^\S+$/);
  mouse(node, "pointermove"); await tick(200); const positive = shown(node); expect(document.activeElement).toBe(peer); expect(peer.getAttribute("aria-describedby")).toBeNull();
  leave(node); gone(node, positive); expect(peer.getAttribute("aria-describedby")).toBeNull(); expect(document.activeElement).toBe(peer);
  act(() => outside().focus()); act(() => peer.focus()); expect(peer.getAttribute("aria-describedby")).toMatch(/^\S+$/); gone(node);
});

function resourceObserver() {
  const registrations: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject; capture: boolean; active: boolean }> = [];
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const capture = (options?: boolean | EventListenerOptions) => typeof options === "boolean" ? options : options?.capture === true;
  const addSpy = vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (this: EventTarget, type, listener, options) {
    if (listener && !registrations.some((row) => row.active && row.target === this && row.type === type && row.listener === listener && row.capture === capture(options))) {
      if (registrations.length >= 4096) throw Error("Owned resource observation overflow");
      registrations.push({ target: this, type, listener, capture: capture(options), active: true });
    }
    return Reflect.apply(add, this, [type, listener, options]);
  });
  const removeSpy = vi.spyOn(EventTarget.prototype, "removeEventListener").mockImplementation(function (this: EventTarget, type, listener, options) {
    registrations.forEach((row) => { if (row.target === this && row.type === type && row.listener === listener && row.capture === capture(options)) row.active = false; });
    return Reflect.apply(remove, this, [type, listener, options]);
  });
  return {
    active: (target: EventTarget, type: string) => registrations.filter((row) => row.active && row.target === target && row.type === type).map((row) => row.listener),
    dispose: () => { removeSpy.mockRestore(); addSpy.mockRestore(); registrations.length = 0; },
  };
}

it("C14 closing releases Content-owned listeners while the mounted controller peer listener may remain", async () => {
  const resources = resourceObserver(); let host: ReturnType<typeof render> | null = null;
  try {
    host = render(view()); const node = trigger(); const peerBefore = resources.active(document, "tooltip.open"), scrollBefore = resources.active(window, "scroll");
    act(() => node.focus()); const positive = shown(node);
    expect(resources.active(document, "tooltip.open").length).toBeGreaterThan(peerBefore.length);
    leave(node); gone(node, positive);
    expect(resources.active(document, "tooltip.open")).toEqual(peerBefore); expect(resources.active(window, "scroll")).toEqual(scrollBefore);
    expect(resources.active(positive.root, "pointerleave")).toEqual([]); expect(resources.active(positive.root, "animationend")).toEqual([]);
    expect(resources.active(positive.root, "animationcancel")).toEqual([]); expect(resources.active(node, "pointerleave")).toEqual([]);
    // There is intentionally no global timer/listener-zero requirement here.
  } finally { try { host?.unmount(); } finally { resources.dispose(); } }
});

it("C15 ordinary close removes Content even under a scoped live-CSSOM exit-animation fixture", async () => {
  const original = globalThis.getComputedStyle; let observedContent: HTMLElement | null = null;
  const styles = vi.spyOn(globalThis, "getComputedStyle").mockImplementation((element, pseudo) => {
    const actual = original.call(window, element, pseudo);
    if (!(element instanceof HTMLElement) || !element.matches('.session-native-composer-tooltip[data-slot="tooltip-content"]')) return actual;
    if (observedContent && observedContent !== element) return actual; observedContent = element;
    // jsdom snapshots computed styles. This one-node-type live-object adapter
    // forces Presence's real exit branch; it is not browser/native paint proof.
    return new Proxy(actual, { get(target, property) {
      if (property === "animationName") return element.dataset.state === "closed" ? "e11-owned-exit" : "e11-owned-enter";
      const value: unknown = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  });
  try {
    // A real raw-Radix positive control proves this CSSOM fixture actually
    // retains closed exit DOM; it is not a no-op animation-name assertion.
    render(<><TooltipProvider><Tooltip disableHoverableContent><TooltipTrigger asChild>
      <button type="button" aria-label="原附加按钮">对照按钮</button></TooltipTrigger>
      <TooltipContent className="session-native-composer-tooltip"><span className="session-native-composer-tooltip-label">对照提示</span></TooltipContent>
    </Tooltip></TooltipProvider><button type="button">外部焦点</button></>);
    const raw = trigger(); act(() => raw.focus()); const exitControl = shown(raw, "对照提示");
    act(() => outside().focus()); expect(raw.getAttribute("aria-describedby")).toBeNull();
    expect(exitControl.root.dataset.state).toBe("closed"); expect(exitControl.root.isConnected).toBe(true);
    expect(getComputedStyle(exitControl.root).animationName).toBe("e11-owned-exit");
    cleanup(); observedContent = null;
    render(view()); const node = trigger(); act(() => node.focus()); const positive = shown(node);
    expect(getComputedStyle(positive.root).animationName).toBe("e11-owned-enter");
    leave(node); gone(node, positive); await tick(0); gone(node, positive);
    // No animationend/cancel event is dispatched to make a retained node pass.
  } finally { try { cleanup(); } finally { styles.mockRestore(); observedContent = null; } }
});

it("C16 unmount releases owned Content and cancels a later pending request without late open", async () => {
  let notifications = 0; const listener = () => { notifications++; }; document.addEventListener("tooltip.open", listener);
  try {
    const host = render(view()); const node = trigger(); act(() => node.focus()); const positive = shown(node); leave(node); gone(node, positive);
    await tick(301); mouse(node, "pointerover"); mouse(node, "pointermove"); await tick(199); gone(node); const before = notifications;
    host.unmount(); await tick(500); expect(notifications).toBe(before); expect(positive.root.isConnected).toBe(false); expect(document.getElementById(positive.id)).toBeNull();
    const nextHost = render(view()); const next = trigger(); expect(next).not.toBe(node); await tick(500); gone(next);
    act(() => next.focus()); shown(next); nextHost.unmount();
  } finally { document.removeEventListener("tooltip.open", listener); }
});
