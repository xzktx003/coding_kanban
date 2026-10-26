import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerTooltip } from "./ComposerTooltip";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@session/components/ui/tooltip";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const tick = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function mouse(node: HTMLElement, type: "pointermove" | "pointerover" | "pointerout" | "pointerdown" | "pointerup" | "pointercancel", pointerType = "mouse", relatedTarget: EventTarget | null = null) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(node, event); return event;
}
function view(popup = false, key = "same") {
  return <><ComposerTooltip label="附加文件" shortcut="@" popupOpen={popup}>
    <button key={key} type="button" aria-label="原附加按钮">按钮正文</button>
  </ComposerTooltip><button type="button">外部焦点</button></>;
}
const button = () => screen.getByRole("button", { name: "原附加按钮" });
const outside = () => screen.getByRole("button", { name: "外部焦点" });
function content(trigger: HTMLElement, label: string | null) {
  const id = trigger.getAttribute("aria-describedby");
  if (label === null) { expect(id).toBeNull(); return null; }
  expect(id).toMatch(/^\S+$/);
  const matches = [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((node) => node.id === id);
  expect(matches).toHaveLength(1);
  const root = matches[0]!.closest<HTMLElement>('[data-slot="tooltip-content"]');
  expect(root).not.toBeNull(); expect(root!.isConnected).toBe(true);
  // Read actual Content/direct child, never the invisible role=tooltip clone.
  const direct = root!.querySelector<HTMLElement>(":scope > .session-native-composer-tooltip-label");
  if (direct) expect(direct.childNodes[0]?.textContent).toBe(label);
  else expect(root!.querySelector(":scope > [data-raw-label]")?.textContent).toBe(label);
  return root!;
}
function noNativeContent() { expect(document.querySelectorAll('.session-native-composer-tooltip[data-slot="tooltip-content"]')).toHaveLength(0); }
function rawPeer(refuse = false) {
  function Peer() {
    const [open, setOpen] = useState(false);
    return <TooltipProvider delayDuration={200}><Tooltip open={open} onOpenChange={(value) => { if (!refuse || value) setOpen(value); }}>
      <TooltipTrigger asChild><button type="button">真实 Radix peer</button></TooltipTrigger>
      <TooltipContent className="raw-peer-content"><span data-raw-label>原生 peer 提示</span></TooltipContent>
    </Tooltip></TooltipProvider>;
  }
  return Peer;
}

it("G1 cold hover opens at 200ms and repeated valid moves never starve the first deadline", async () => {
  render(view()); const trigger = button(); mouse(trigger, "pointermove"); await tick(100);
  mouse(trigger, "pointermove"); await tick(99); content(trigger, null); noNativeContent();
  await tick(1); const root = content(trigger, "附加文件");
  expect(root!.querySelector(":scope > .session-native-composer-tooltip-label > kbd")?.textContent).toBe("@");
});

it("G2 same captured Button reenters after popup without pointerleave and release alone stays closed", async () => {
  const mount = render(view()); const trigger = button(); mouse(trigger, "pointermove"); await tick(200); content(trigger, "附加文件");
  mount.rerender(view(true)); content(trigger, null); noNativeContent(); await tick(351);
  mount.rerender(view(false)); expect(button()).toBe(trigger); expect(trigger.textContent).toBe("按钮正文");
  await tick(201); content(trigger, null); noNativeContent();
  mouse(trigger, "pointermove"); await tick(199); content(trigger, null); await tick(1); content(trigger, "附加文件");
});

it("G3 suppression at 199ms revokes the old request and a new input receives a complete delay", async () => {
  const mount = render(view()); const trigger = button(); mouse(trigger, "pointermove"); await tick(199);
  mount.rerender(view(true)); mount.rerender(view(false)); await tick(1); content(trigger, null); noNativeContent();
  mouse(trigger, "pointermove"); await tick(199); content(trigger, null); await tick(1); content(trigger, "附加文件");
});

it("G3 repeated popup transitions cannot revive an input received under suppression", async () => {
  const mount = render(view(true)); const trigger = button(); mouse(trigger, "pointermove"); await tick(199);
  mount.rerender(view(false)); mount.rerender(view(true)); mount.rerender(view(false)); await tick(500);
  expect(button()).toBe(trigger); content(trigger, null); noNativeContent();
  mouse(trigger, "pointermove"); await tick(199); content(trigger, null); await tick(1); content(trigger, "附加文件");
});

it.each(["leave", "down", "contextmenu"] as const)("G4 pending %s cancels the old generation", async (reason) => {
  render(view()); const trigger = button(); mouse(trigger, "pointermove"); await tick(199);
  if (reason === "leave") mouse(trigger, "pointerout", "mouse", outside());
  if (reason === "down") { mouse(trigger, "pointerdown"); mouse(trigger, "pointerup"); }
  if (reason === "contextmenu") fireEvent.contextMenu(trigger);
  await tick(500); content(trigger, null); noNativeContent();
});

it("G4 a real blur cancels hover pending on an already focused suppressed-then-released Button", async () => {
  const mount = render(view(true)); const trigger = button(); act(() => trigger.focus());
  expect(document.activeElement).toBe(trigger); mount.rerender(view(false));
  mouse(trigger, "pointermove"); await tick(199); act(() => outside().focus());
  expect(document.activeElement).toBe(outside()); await tick(500); content(trigger, null); noNativeContent();
});

it("G4 replacing the actual child node cancels its pending request", async () => {
  const mount = render(view()); const old = button(); mouse(old, "pointermove"); await tick(199);
  mount.rerender(view(false, "replacement")); const next = button(); expect(next).not.toBe(old); expect(old.isConnected).toBe(false);
  await tick(500); content(next, null); noNativeContent(); mouse(next, "pointermove"); await tick(200); content(next, "附加文件");
});

it("G4 actual ownerDocument adoption invalidates an old request without claiming cross-document Content placement", async () => {
  const mount = render(view()); const trigger = button(), parent = trigger.parentNode!;
  const frame = document.createElement("iframe"); document.body.append(frame); const foreign = frame.contentDocument!; let mounted = true;
  try {
    mouse(trigger, "pointermove"); await tick(199); foreign.body.append(foreign.adoptNode(trigger));
    expect(trigger.ownerDocument).toBe(foreign); expect(trigger.isConnected).toBe(true); await tick(500); noNativeContent();
    // Restore the real node before React unmount; no foreign-window placement assertion.
    parent.append(document.adoptNode(trigger)); mount.unmount(); mounted = false;
    act(() => foreign.dispatchEvent(new CustomEvent("tooltip.open"))); await tick(500); noNativeContent();
  } finally { if (trigger.ownerDocument !== document) parent.append(document.adoptNode(trigger)); if (mounted) mount.unmount(); frame.remove(); }
});

it("G4 unmount cancels pending and emits no late open into a fresh controller", async () => {
  let notifications = 0; const collect = () => { notifications++; };
  document.addEventListener("tooltip.open", collect);
  try {
    const first = render(view()); mouse(button(), "pointermove"); await tick(199); first.unmount();
    const second = render(view()); await tick(500); content(button(), null); noNativeContent(); expect(notifications).toBe(0);
    mouse(button(), "pointermove"); await tick(200); content(button(), "附加文件"); expect(notifications).toBe(1); second.unmount();
  } finally { document.removeEventListener("tooltip.open", collect); }
});

it("G5 pointer-down focus stays closed, then a fresh focus opens while props ref and ordinary click survive", async () => {
  const ref = createRef<HTMLButtonElement>(); const clicks: boolean[] = []; let downs = 0;
  render(<><ComposerTooltip label="选择强度"><button ref={ref} type="button" aria-label="动作按钮" data-original="kept"
    onPointerDown={() => { downs++; }} onClick={(event: ReactMouseEvent<HTMLButtonElement>) => clicks.push(event.defaultPrevented)}>动作正文</button>
  </ComposerTooltip><button type="button">外部焦点</button></>);
  const trigger = screen.getByRole("button", { name: "动作按钮" }); expect(ref.current).toBe(trigger);
  expect(mouse(trigger, "pointerdown").defaultPrevented).toBe(false); act(() => trigger.focus()); mouse(trigger, "pointerup"); fireEvent.click(trigger);
  await tick(201); content(trigger, null); expect(clicks).toEqual([false]); expect(downs).toBe(1);
  expect(trigger.getAttribute("data-original")).toBe("kept"); expect(trigger.textContent).toBe("动作正文"); expect(ref.current).toBe(trigger);
  act(() => outside().focus()); act(() => trigger.focus()); content(trigger, "选择强度");
});

it("G5 pointer cancellation releases its down gating and a later genuine focus remains usable", async () => {
  render(view()); const trigger = button(); mouse(trigger, "pointerdown"); act(() => trigger.focus()); mouse(trigger, "pointercancel");
  await tick(201); content(trigger, null); act(() => outside().focus()); act(() => trigger.focus()); content(trigger, "附加文件");
});

it("G5 touch moves never request a tooltip", async () => {
  render(view()); mouse(button(), "pointermove", "touch"); await tick(500); content(button(), null); noNativeContent();
});

it("G5 child-prevented managed pointer and focus events remain inert without blocking ordinary actions", async () => {
  let clicks = 0;
  render(<ComposerTooltip label="不得出现"><button type="button" onPointerMove={(event) => event.preventDefault()}
    onFocus={(event) => event.preventDefault()} onClick={() => { clicks++; }}>被阻止的子项</button></ComposerTooltip>);
  const trigger = screen.getByRole("button", { name: "被阻止的子项" });
  expect(mouse(trigger, "pointermove").defaultPrevented).toBe(true); act(() => trigger.focus()); await tick(500);
  content(trigger, null); noNativeContent(); fireEvent.click(trigger); expect(clicks).toBe(1);
});

it("G6 actual close admits skip reentry before its 300ms deadline", async () => {
  render(view()); const trigger = button(); act(() => trigger.focus()); content(trigger, "附加文件"); act(() => outside().focus()); content(trigger, null);
  await tick(299); mouse(trigger, "pointermove"); await tick(0); content(trigger, "附加文件");
});

it("G6 repeated false close cannot extend the original 300ms skip deadline", async () => {
  render(view()); const trigger = button(); act(() => trigger.focus()); act(() => outside().focus()); await tick(200);
  mouse(trigger, "pointerdown"); mouse(trigger, "pointerup"); fireEvent.contextMenu(trigger); await tick(101);
  mouse(trigger, "pointerover");
  mouse(trigger, "pointermove"); await tick(199); content(trigger, null); await tick(1); content(trigger, "附加文件");
});

it("G6 cancellation before any actual open never creates a skip deadline", async () => {
  render(view()); const trigger = button(); mouse(trigger, "pointermove"); await tick(199); mouse(trigger, "pointerout", "mouse", outside());
  mouse(trigger, "pointermove"); await tick(199); content(trigger, null); await tick(1); content(trigger, "附加文件");
});

it("G7 same-event close and fresh focus can reopen on the same actual Button without self-dismissal", async () => {
  render(view()); const trigger = button(); act(() => trigger.focus()); const root = content(trigger, "附加文件");
  act(() => { outside().focus(); trigger.focus(); }); expect(button()).toBe(trigger); expect(document.activeElement).toBe(trigger);
  content(trigger, "附加文件"); expect(root!.ownerDocument).toBe(document);
  // jsdom has no native exit paint. Actual CSS Presence is covered only by browsers.
});

it("G7 already open moves and entry do not rebroadcast or dismiss their own Content", async () => {
  let notifications = 0; const collect = () => { notifications++; }; document.addEventListener("tooltip.open", collect);
  try {
    render(view()); const trigger = button(); mouse(trigger, "pointermove"); await tick(200); const root = content(trigger, "附加文件"); expect(notifications).toBe(1);
    mouse(trigger, "pointerover"); mouse(trigger, "pointermove"); mouse(trigger, "pointermove"); await tick(500);
    expect(content(trigger, "附加文件")).toBe(root); expect(notifications).toBe(1);
  } finally { document.removeEventListener("tooltip.open", collect); }
});

it("G8 two real Commons coordinate while the old trigger remains focused and never leaves", async () => {
  render(<><ComposerTooltip label="第一提示"><button type="button">第一按钮</button></ComposerTooltip><ComposerTooltip label="第二提示"><button type="button">第二按钮</button></ComposerTooltip></>);
  const first = screen.getByRole("button", { name: "第一按钮" }), second = screen.getByRole("button", { name: "第二按钮" });
  act(() => first.focus()); content(first, "第一提示"); mouse(second, "pointermove"); await tick(200);
  expect(document.activeElement).toBe(first); content(first, null); content(second, "第二提示");
});

it("G8 an actual raw Radix controlled peer accepts false while a Common opens without peer blur", async () => {
  const Peer = rawPeer(); render(<><Peer /><ComposerTooltip label="附加文件"><button type="button" aria-label="原附加按钮">按钮正文</button></ComposerTooltip></>);
  const peer = screen.getByRole("button", { name: "真实 Radix peer" }); act(() => peer.focus()); content(peer, "原生 peer 提示");
  const trigger = button(); mouse(trigger, "pointermove"); await tick(200); expect(document.activeElement).toBe(peer); content(peer, null); content(trigger, "附加文件");
});

it("G8 raw Radix opening closes a focused Common without moving that Common focus", async () => {
  const Peer = rawPeer(); render(<><ComposerTooltip label="附加文件"><button type="button" aria-label="原附加按钮">按钮正文</button></ComposerTooltip><Peer /></>);
  const trigger = button(), peer = screen.getByRole("button", { name: "真实 Radix peer" }); act(() => trigger.focus()); content(trigger, "附加文件");
  mouse(peer, "pointermove"); await tick(200); expect(document.activeElement).toBe(trigger); content(trigger, null); content(peer, "原生 peer 提示");
});

it("G8 an explicitly refusing raw controlled peer stays open without a force-close claim", async () => {
  const Peer = rawPeer(true); render(<><Peer /><ComposerTooltip label="附加文件"><button type="button" aria-label="原附加按钮">按钮正文</button></ComposerTooltip></>);
  const peer = screen.getByRole("button", { name: "真实 Radix peer" }); act(() => peer.focus()); content(peer, "原生 peer 提示");
  mouse(button(), "pointermove"); await tick(200); expect(document.activeElement).toBe(peer); content(peer, "原生 peer 提示"); content(button(), "附加文件");
});

it("G9 a nested foreign no-detail notification during own dispatch cancels that own generation", async () => {
  render(view()); const trigger = button(); let nesting = false, outer = 0;
  const nested = () => { if (!nesting) { outer++; nesting = true; try { document.dispatchEvent(new CustomEvent("tooltip.open")); } finally { nesting = false; } } };
  document.addEventListener("tooltip.open", nested);
  try { mouse(trigger, "pointermove"); await tick(200); expect(outer).toBe(1); content(trigger, null); noNativeContent(); }
  finally { document.removeEventListener("tooltip.open", nested); }
});

it("G9 a foreign notification cancels pending and unmount removes all externally observable late opens", async () => {
  const mount = render(view()); const trigger = button(); mouse(trigger, "pointermove"); await tick(199);
  act(() => document.dispatchEvent(new CustomEvent("tooltip.open"))); await tick(500); content(trigger, null); noNativeContent();
  mount.unmount(); let seen = 0; const collect = () => { seen++; }; document.addEventListener("tooltip.open", collect);
  try { fireEvent(document, new Event("pointerup", { bubbles: true })); document.dispatchEvent(new CustomEvent("tooltip.open")); await tick(500); expect(seen).toBe(1); noNativeContent(); }
  finally { document.removeEventListener("tooltip.open", collect); }
});

import { forwardRef, type ComponentPropsWithoutRef } from "react";

function mountIndependentTriggerChild() {
  const ref = createRef<HTMLButtonElement>();
  let changeVisible: ((visible: boolean) => void) | undefined;
  let hostRenders = 0;
  const Child = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(function IndependentTriggerChild(props, forwardedRef) {
    const [visible, setVisible] = useState(true);
    changeVisible = setVisible;
    return visible ? <button {...props} ref={forwardedRef} /> : null;
  });
  function Host() {
    hostRenders++;
    return <><ComposerTooltip label="附加文件" shortcut="@">
      <Child ref={ref} type="button" aria-label="原附加按钮" data-original="kept">按钮正文</Child>
    </ComposerTooltip><button type="button">外部焦点</button></>;
  }
  const mounted = render(<Host />);
  return {
    ref,
    mounted,
    hostRenderCount: () => hostRenders,
    setVisible: (visible: boolean) => {
      const update = changeVisible;
      if (update === undefined) throw new Error("Independent child has not mounted");
      act(() => update(visible));
    },
  };
}

it("G10 same actual Button keeps its first hover deadline and open Content through ordinary parent rerenders", async () => {
  const ref = createRef<HTMLButtonElement>();
  let notifications = 0;
  const collect = () => { notifications++; };
  document.addEventListener("tooltip.open", collect);
  try {
    const sameView = () => <><ComposerTooltip label="附加文件" shortcut="@">
      <button ref={ref} type="button" aria-label="原附加按钮" data-original="kept">按钮正文</button>
    </ComposerTooltip><button type="button">外部焦点</button></>;
    const mount = render(sameView());
    const trigger = button(), ownerDocument = trigger.ownerDocument;
    expect(ref.current).toBe(trigger);
    mouse(trigger, "pointermove"); await tick(100);
    mount.rerender(sameView());
    expect(button()).toBe(trigger); expect(ref.current).toBe(trigger);
    expect(trigger.isConnected).toBe(true); expect(trigger.ownerDocument).toBe(ownerDocument);
    expect(trigger.getAttribute("aria-label")).toBe("原附加按钮");
    expect(trigger.getAttribute("data-original")).toBe("kept"); expect(trigger.textContent).toBe("按钮正文");
    await tick(99); content(trigger, null); noNativeContent(); expect(notifications).toBe(0);
    await tick(1);
    const firstRoot = content(trigger, "附加文件"), firstID = trigger.getAttribute("aria-describedby");
    if (firstRoot === null || firstID === null) throw new Error("Initial positive Content was not reached");
    expect(notifications).toBe(1);
    mount.rerender(sameView()); await tick(0);
    expect(button()).toBe(trigger); expect(ref.current).toBe(trigger);
    expect(trigger.ownerDocument).toBe(ownerDocument); expect(trigger.isConnected).toBe(true);
    expect(trigger.getAttribute("aria-label")).toBe("原附加按钮");
    expect(trigger.getAttribute("data-original")).toBe("kept"); expect(trigger.textContent).toBe("按钮正文");
    expect(trigger.getAttribute("aria-describedby")).toBe(firstID);
    expect(content(trigger, "附加文件")).toBe(firstRoot); expect(firstRoot.isConnected).toBe(true);
    mouse(trigger, "pointermove"); await tick(500);
    expect(content(trigger, "附加文件")).toBe(firstRoot); expect(notifications).toBe(1);
  } finally { document.removeEventListener("tooltip.open", collect); }
});

it("G10 child-only state removal cancels pending at 199ms and a new actual Button inherits no request", async () => {
  let notifications = 0;
  const collect = () => { notifications++; };
  document.addEventListener("tooltip.open", collect);
  try {
    const host = mountIndependentTriggerChild();
    const original = button(), ownerDocument = original.ownerDocument, renders = host.hostRenderCount();
    expect(host.ref.current).toBe(original);
    mouse(original, "pointermove"); await tick(199); content(original, null); noNativeContent();
    expect(notifications).toBe(0);
    host.setVisible(false);
    expect(host.hostRenderCount()).toBe(renders); expect(original.isConnected).toBe(false);
    expect(host.ref.current).toBeNull(); expect(screen.queryByRole("button", { name: "原附加按钮" })).toBeNull();
    await tick(0); noNativeContent(); expect(notifications).toBe(0);
    host.setVisible(true);
    const next = button();
    expect(host.hostRenderCount()).toBe(renders); expect(next).not.toBe(original);
    expect(next.ownerDocument).toBe(ownerDocument); expect(next.isConnected).toBe(true); expect(host.ref.current).toBe(next);
    expect(next.getAttribute("aria-label")).toBe("原附加按钮");
    expect(next.getAttribute("data-original")).toBe("kept"); expect(next.textContent).toBe("按钮正文");
    await tick(1); content(next, null); noNativeContent(); expect(notifications).toBe(0);
    await tick(500); content(next, null); noNativeContent(); expect(notifications).toBe(0);
    expect(document.activeElement).not.toBe(next);
    act(() => next.focus()); expect(document.activeElement).toBe(next);
    content(next, "附加文件"); expect(host.ref.current).toBe(next); expect(host.hostRenderCount()).toBe(renders);
    expect(notifications).toBe(1);
  } finally { document.removeEventListener("tooltip.open", collect); }
});

it("G10 child-only state removal closes actual open Content and remount requires a fresh real focus", async () => {
  let notifications = 0;
  const collect = () => { notifications++; };
  document.addEventListener("tooltip.open", collect);
  try {
    const host = mountIndependentTriggerChild();
    const original = button(), ownerDocument = original.ownerDocument, renders = host.hostRenderCount();
    expect(host.ref.current).toBe(original);
    act(() => original.focus()); expect(document.activeElement).toBe(original);
    const firstRoot = content(original, "附加文件"), firstID = original.getAttribute("aria-describedby");
    if (firstRoot === null || firstID === null) throw new Error("Initial positive Content was not reached");
    expect(notifications).toBe(1);
    host.setVisible(false);
    expect(host.hostRenderCount()).toBe(renders); expect(original.isConnected).toBe(false);
    expect(host.ref.current).toBeNull(); expect(screen.queryByRole("button", { name: "原附加按钮" })).toBeNull();
    await tick(0);
    noNativeContent(); expect(firstRoot.isConnected).toBe(false); expect(document.getElementById(firstID)).toBeNull();
    expect(notifications).toBe(1);
    host.setVisible(true);
    const next = button();
    expect(host.hostRenderCount()).toBe(renders); expect(next).not.toBe(original);
    expect(next.isConnected).toBe(true); expect(next.ownerDocument).toBe(ownerDocument); expect(host.ref.current).toBe(next);
    expect(next.getAttribute("aria-label")).toBe("原附加按钮");
    expect(next.getAttribute("data-original")).toBe("kept"); expect(next.textContent).toBe("按钮正文");
    await tick(500); content(next, null); noNativeContent(); expect(notifications).toBe(1);
    expect(document.activeElement).not.toBe(next);
    act(() => next.focus()); expect(document.activeElement).toBe(next);
    content(next, "附加文件"); expect(host.ref.current).toBe(next); expect(host.hostRenderCount()).toBe(renders);
    expect(notifications).toBe(2);
  } finally { document.removeEventListener("tooltip.open", collect); }
});
