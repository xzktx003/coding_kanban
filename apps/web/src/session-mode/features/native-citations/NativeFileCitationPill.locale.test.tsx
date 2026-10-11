import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeFileCitationPill } from "./NativeFileCitationPill";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: undefined } }),
}));
it("renders and labels a citation before the language service finishes initializing", () => {
  render(
    <NativeFileCitationPill
      citation={{
        kind: "file",
        path: "/fixture/source.ts",
        lineStart: 12,
        lineEnd: 14,
      }}
      owner={{ cwd: "/fixture" }}
      onOpen={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", { name: /source\.ts.*12-14/ }),
  ).not.toBeNull();
  expect(
    screen.getByRole("button", { name: /source\.ts.*12-14/ }).textContent,
  ).toContain("第 12-14 行");
});
