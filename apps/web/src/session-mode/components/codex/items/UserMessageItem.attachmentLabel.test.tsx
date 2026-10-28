import { render, screen } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";
import { zh } from "@session/locales/zh";
import { UserMessageItem } from "./UserMessageItem";

vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));

/**
 * Codex 26.51007.21434 `user-message-attachments-e8e099c7e282.js` labels a user
 * attachment with `alt ?? formatMessage(userImageAttachment)`:
 *
 *   V = c ?? O.formatMessage({ id: `codex.localConversation.userImageAttachment`,
 *                              defaultMessage: `User attachment` })
 *
 * and the list wrapper hands that one `alt` to every thumbnail — the map's index
 * only feeds React keys and the prev/next callbacks:
 *
 *   (e, t) => jsx(En, { src: e, alt: a, availableImageCount: n.length,
 *                       open: c === t, onPreviousImage: t === 0 ? … }, t)
 *
 * zh-CN: `codex.localConversation.userImageAttachment` = `用户附件`. So every
 * attachment carries the same localized label with no per-image numbering;
 * `Uploaded 1` was both untranslated and an index the original never shows.
 */
const png = "data:image/png;base64,AA==";

async function withZh() {
  const locale = createInstance();
  // The real catalog, so the assertion pins the shipped string rather than a
  // fixture that could drift away from it.
  await locale.init({ lng: "zh", resources: { zh } });
  return locale;
}

it("labels user attachments with the official localized name", async () => {
  const locale = await withZh();
  render(
    <I18nextProvider i18n={locale}>
      <div className="session-mode">
        <UserMessageItem content={[{ type: "image", url: png } as never]} />
      </div>
    </I18nextProvider>,
  );
  expect(screen.getByRole("img", { name: "用户附件" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "放大用户附件" })).toBeTruthy();
});

it("gives every attachment the same label, without inventing an index", async () => {
  const locale = await withZh();
  render(
    <I18nextProvider i18n={locale}>
      <div className="session-mode">
        <UserMessageItem
          content={
            [
              { type: "image", url: png },
              { type: "image", url: `${png}#second` },
            ] as never
          }
        />
      </div>
    </I18nextProvider>,
  );
  expect(screen.getAllByRole("img", { name: "用户附件" }).length).toBe(2);
  // The original never numbers attachments; nothing may read "Uploaded 2".
  expect(screen.queryByRole("img", { name: /Uploaded/ })).toBeNull();
});
