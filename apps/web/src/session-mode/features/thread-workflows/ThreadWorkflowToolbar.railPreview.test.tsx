import { act, fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { zh } from "@session/locales/zh";
import { ThreadUserNavigationRail } from "./ThreadWorkflowToolbar";

vi.mock("./service", () => ({ downloadThreadMarkdown: vi.fn() }));

/**
 * Codex 26.51007.21434 `thread-user-message-navigation-rail-5c89c24e73d1.js`
 * opens a structured hover preview beside the rail marker, not a native
 * `title` tooltip. Three facts drive this test:
 *
 * 1. The open is delayed, and a row already in the preview cache reopens with
 *    no wait. The delay is 200ms, resolved through the shared tooltip's
 *    `delayDuration ?? n ?? 200` default; `jt=150` in the rail module is the
 *    separate prefetch delay. See the last test in this file for the evidence.
 * 2. The card is `[data-thread-user-message-navigation-tooltip-preview]` and
 *    holds a `font-medium` label line plus the turn's response, clamped with
 *    `mt-1 line-clamp-3`.
 * 3. An empty user message falls back to `thread.userMessageNavigation.noContent`
 *    (`（无内容）`) rather than rendering a blank card.
 *
 * zh-CN strings come from `zh-CN-b05cfd55c534.js`; `ariaLabel` is `用户消息` and
 * `jumpAriaLabel` is `跳转到用户消息 {position}`.
 */
const HOVER_DEBOUNCE_MS = 200;

// A prompt and the reply it produced share one `turnId`, the way real
// transcript rows do — that pairing is what the rail reads to build a preview.
const row = (
  index: number,
  turn: number,
  role: "user" | "assistant",
  text: string,
) => ({
  rowId: `row-${index}`,
  itemId: `item-${index}`,
  turnId: `turn-${turn}`,
  role,
  text,
  completed: true,
});

// Four user prompts is the rail's own minimum; each carries an assistant reply
// so the preview has a response to clamp.
const rows = [
  row(0, 0, "user", "第一个问题"),
  row(1, 0, "assistant", "第一个回答"),
  row(2, 1, "user", "第二个问题"),
  row(3, 1, "assistant", "第二个回答"),
  row(4, 2, "user", ""),
  row(5, 2, "assistant", "第三个回答"),
  row(6, 3, "user", "第四个问题"),
  row(7, 3, "assistant", "第四个回答"),
];

async function mount() {
  const locale = createInstance();
  await locale.init({ lng: "zh", resources: { zh } });
  return render(
    <I18nextProvider i18n={locale}>
      <div className="session-mode">
        <ThreadUserNavigationRail rows={rows} onNavigate={vi.fn()} />
      </div>
    </I18nextProvider>,
  );
}

const markers = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-thread-user-message-navigation-item-id]",
    ),
  );

const preview = () =>
  document.querySelector(
    "[data-thread-user-message-navigation-tooltip-preview]",
  );

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

it("opens the hover preview only after the official debounce", async () => {
  await mount();
  fireEvent.pointerEnter(markers()[0]);
  // Before the debounce elapses the plugin shows nothing at all.
  expect(preview()).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS);
  });
  expect(preview()).toBeTruthy();
});

it("shows the prompt label and its clamped response", async () => {
  await mount();
  fireEvent.pointerEnter(markers()[0]);
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS);
  });
  const card = preview()!;
  expect(card.textContent).toContain("第一个问题");
  expect(card.textContent).toContain("第一个回答");
  const response = card.querySelector("[data-rail-preview-response]")!;
  expect(response.className).toContain("line-clamp-3");
});

it("falls back to the official empty-message label", async () => {
  await mount();
  // The third prompt carries no text; official renders `（无内容）`.
  fireEvent.pointerEnter(markers()[2]);
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS);
  });
  expect(preview()!.textContent).toContain("（无内容）");
});

it("reopens a cached preview without waiting again", async () => {
  await mount();
  fireEvent.pointerEnter(markers()[0]);
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS);
  });
  fireEvent.pointerLeave(markers()[0]);
  expect(preview()).toBeNull();
  // Already cached, so the plugin skips its timer entirely on the way back in.
  fireEvent.pointerEnter(markers()[0]);
  expect(preview()).toBeTruthy();
});

it("keeps the jump label localized and positioned", async () => {
  await mount();
  expect(screen.getByRole("button", { name: "跳转到用户消息 1" })).toBeTruthy();
  expect(markers()[0].hasAttribute("title")).toBe(false);
});

it("portals the card out of the scrolling rail", async () => {
  const view = await mount();
  fireEvent.pointerEnter(markers()[0]);
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS);
  });
  const card = preview()!;
  const rail = view.container.querySelector(".codex-thread-user-rail")!;
  // `.codex-thread-user-rail` is `overflow-y: auto` under a fade `mask`, so a
  // card nested in a marker is clipped on both axes in a real browser — jsdom
  // enforces neither, which is exactly why this has to be asserted structurally.
  expect(rail.contains(card)).toBe(false);
  // It still has to live under `.session-mode`, or none of our scoped styling
  // and no Portal-bound shortcut handling applies to it.
  expect(view.container.querySelector(".session-mode")!.contains(card)).toBe(
    true,
  );
  // Fixed coordinates are what replace the nesting that used to position it.
  expect((card as HTMLElement).style.position).toBe("fixed");
});

it("marks a settled turn with no body as unavailable", async () => {
  const locale = createInstance();
  await locale.init({ lng: "zh", resources: { zh } });
  // A reply that completed carrying no text: the body is gone, not pending, so
  // official stops showing a skeleton and says so.
  const settled = [
    row(0, 0, "user", "问题一"),
    { ...row(1, 0, "assistant", ""), completed: true },
    row(2, 1, "user", "问题二"),
    row(3, 1, "assistant", "回答二"),
    row(4, 2, "user", "问题三"),
    row(5, 2, "assistant", "回答三"),
    row(6, 3, "user", "问题四"),
    row(7, 3, "assistant", "回答四"),
  ];
  render(
    <I18nextProvider i18n={locale}>
      <div className="session-mode">
        <ThreadUserNavigationRail rows={settled} onNavigate={vi.fn()} />
      </div>
    </I18nextProvider>,
  );
  fireEvent.pointerEnter(markers()[0]);
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS);
  });
  expect(preview()!.textContent).toContain("预览不可用");
});

it("shows the loading skeleton while a turn has no reply row yet", async () => {
  const locale = createInstance();
  await locale.init({ lng: "zh", resources: { zh } });
  // The last prompt has no assistant row at all: the turn is still producing
  // its first message, which is the skeleton's case rather than unavailable's.
  const streaming = [
    row(0, 0, "user", "问题一"),
    row(1, 0, "assistant", "回答一"),
    row(2, 1, "user", "问题二"),
    row(3, 1, "assistant", "回答二"),
    row(4, 2, "user", "问题三"),
    row(5, 2, "assistant", "回答三"),
    row(6, 3, "user", "问题四"),
  ];
  render(
    <I18nextProvider i18n={locale}>
      <div className="session-mode">
        <ThreadUserNavigationRail rows={streaming} onNavigate={vi.fn()} />
      </div>
    </I18nextProvider>,
  );
  fireEvent.pointerEnter(markers()[3]);
  await act(async () => {
    vi.advanceTimersByTime(HOVER_DEBOUNCE_MS);
  });
  const card = preview()!;
  expect(card.querySelector("[role=status]")).toBeTruthy();
  expect(card.textContent).toContain("正在加载预览");
});

/**
 * The open delay is 200ms, not the 150ms this file originally assumed.
 *
 * Codex 26.51007.21434 has two distinct delays on this rail, and reading only
 * the rail module conflates them. `jt=150` (declared beside
 * `Mt=`[data-turn-key]`` in `thread-user-message-navigation-rail-5c89c24e73d1.js`)
 * schedules `xe`, which is the preview *prefetch*:
 *
 *   oe.current.has(e.id) || (oe.current.add(e.id),
 *     u(e).then(t => { t === !1 && oe.current.delete(e.id) })…)
 *   … setTimeout(() => { E.current = null; xe(e) }, jt)
 *
 * That cache fetches data and evicts on failure; it never opens a card. The
 * card is a shared tooltip the rail renders with `delayOpen:!0` and
 * `skipDelayKey:`thread-user-message-navigation``, passing no `delayDuration`
 * at all, so its open delay resolves through the tooltip's own default:
 *
 *   delayDuration ?? n ?? 200
 *
 * with the context (`t4t`) defaulting to `null`. `chatgpt-conversation-turn-content`
 * independently passes `delayDuration:200` for the transcript, which confirms
 * the same figure from the other direction.
 *
 * Our rows are already in memory and `previewFor` reads them synchronously, so
 * there is nothing for a prefetch delay to govern here — the only delay we have
 * is the open, and 200 is its value.
 */
it("waits the official 200ms open delay, not 150ms", async () => {
  await mount();
  fireEvent.pointerEnter(markers()[0]);
  // Still closed at the moment a 150ms debounce would have fired.
  await act(async () => {
    vi.advanceTimersByTime(150);
  });
  expect(preview()).toBeNull();
  // The remaining 50ms reaches the shared tooltip's default and it opens.
  await act(async () => {
    vi.advanceTimersByTime(50);
  });
  expect(preview()).toBeTruthy();
});
