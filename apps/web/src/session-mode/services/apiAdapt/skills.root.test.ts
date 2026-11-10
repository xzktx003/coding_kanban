import { expect, it, vi } from "vitest";

vi.mock("./shared", () => ({ postJson: vi.fn(async () => ({ data: [] })) }));

it("uses the official root scope when a goal has no workspace", async () => {
  const { postJson } = await import("./shared");
  const { skillList } = await import("./skills");
  await skillList(null);
  expect(postJson).toHaveBeenCalledWith("/api/codex/skills/list", { cwds: ["/"] });
});
