import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NativeGeneratedImages } from "./NativeGeneratedImages";
vi.mock("@session/contexts/ThemeContext", () => ({
  useThemeContext: () => ({ resolvedTheme: "dark" }),
}));
const quota = {
  id: "quota",
  type: "imageGeneration",
  status: "failed",
  result: "",
  revisedPrompt: null,
  transcriptMetadataOnly: true,
  failure: {
    type: "usageLimitExceeded",
    limitId: "image_gen",
    resetsAt: 1_900_000_000,
  },
};

it("shows the exact native image quota failure and reset time even in the cropped chat view", () => {
  render(<NativeGeneratedImages items={[quota]} />);
  expect(screen.getByRole("status").textContent).toMatch(/你已达到图像创建上限。请在 .+ 重试/);
  expect(screen.getByRole("status").className).toContain("codex-native-divider");
  expect(screen.getByRole("status").querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 16 16");
  expect(screen.queryByText(/activity.imageFailed/)).toBeNull();
});
it("retains completed pixels next to an explicit quota failure without claiming a new image is still generating", () => {
  const exhausted = { ...quota, failure: { ...quota.failure, resetsAt: null } };
  render(
    <NativeGeneratedImages
      running
      items={[
        {
          id: "ready",
          status: "completed",
          revisedPrompt: null,
          result:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/DZkAAAAASUVORK5CYII=",
        },
        exhausted,
      ]}
    />,
  );
  expect(screen.getByRole("img")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(
    /你已达到图像创建上限。请稍后重试/,
  );
  expect(screen.queryByText("activity.generatingImage")).toBeNull();
});
it("never infers image quota from generic failure text or another limit id", () => {
  const differentLimit = {
    ...quota,
    failure: { ...quota.failure, limitId: "tokens" },
  };
  render(<NativeGeneratedImages items={[differentLimit]} />);
  expect(screen.queryByText(/你已达到图像创建上限/)).toBeNull();
});
