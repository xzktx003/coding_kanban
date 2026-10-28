import { fireEvent, render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";
import { zh } from "@session/locales/zh";
import { CodexImage } from "./CodexImage";

/**
 * Codex 26.51007.21434 `user-message-attachments-e8e099c7e282.js` renders an
 * attachment whose bytes could not be loaded as a plain non-interactive box,
 * distinctly smaller than a loaded one and carrying its own danger styling:
 *
 *   <div className="flex size-16 items-center justify-center rounded-lg
 *                   border border-text-danger/20 bg-background-danger-surface/20
 *                   px-1 text-center text-[10px] leading-3 text-danger"
 *        role="img" aria-label={userImageAttachmentFailed}>
 *     {userImageAttachmentFailedShort}
 *   </div>
 *
 * zh-CN: `codex.localConversation.userImageAttachmentFailed` = `图片加载失败`
 * (the label) and `...FailedShort` = `失败` (the visible text). The loaded and
 * still-resolving branches are both `size-20`, so the failed tile is the only
 * one at 16 — the size itself is a signal, not decoration.
 *
 * It is specifically NOT a button: there is nothing to zoom into, so the
 * zoom affordance and its dialog must disappear with the bytes.
 */
const broken = "data:image/png;base64,AA==";

async function withZh() {
  const locale = createInstance();
  // The real catalog, so these assertions pin the shipped strings.
  await locale.init({ lng: "zh", resources: { zh } });
  return locale;
}

it("shows a failed attachment as a non-interactive danger tile", async () => {
  const locale = await withZh();
  render(
    <I18nextProvider i18n={locale}>
      <div className="session-mode">
        <CodexImage src={broken} alt="用户附件" />
      </div>
    </I18nextProvider>,
  );
  fireEvent.error(screen.getByRole("img", { name: "用户附件" }));
  const failed = screen.getByRole("img", { name: "图片加载失败" });
  expect(failed.textContent).toBe("失败");
  // Official drops the zoom affordance entirely once the bytes are gone.
  expect(screen.queryByRole("button")).toBeNull();
  expect(failed.tagName).toBe("DIV");
});

it("keeps reporting the failure to the caller", async () => {
  const locale = await withZh();
  let reported = 0;
  render(
    <I18nextProvider i18n={locale}>
      <div className="session-mode">
        <CodexImage src={broken} alt="用户附件" onError={() => reported++} />
      </div>
    </I18nextProvider>,
  );
  fireEvent.error(screen.getByRole("img", { name: "用户附件" }));
  expect(reported).toBe(1);
  expect(screen.getByRole("img", { name: "图片加载失败" })).toBeTruthy();
});

it("leaves a loaded attachment zoomable", async () => {
  const locale = await withZh();
  render(
    <I18nextProvider i18n={locale}>
      <div className="session-mode">
        <CodexImage src={broken} alt="用户附件" />
      </div>
    </I18nextProvider>,
  );
  expect(screen.getByRole("button", { name: "放大用户附件" })).toBeTruthy();
  expect(screen.queryByRole("img", { name: "图片加载失败" })).toBeNull();
});
