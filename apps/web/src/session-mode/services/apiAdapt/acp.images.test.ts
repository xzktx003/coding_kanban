import { expect, test, vi, afterEach } from "vitest";
vi.mock("./shared", () => ({
  postJson: vi.fn(async () => ({ stopReason: "end_turn" })),
}));
import { postJson } from "./shared";
import { acpPrompt } from "./acp";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
test("older runtimes cannot silently drop image attachments", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ status: "ok" }) })),
  );
  await expect(
    acpPrompt("connection", "session", "look", ["/uploads/a.png"]),
  ).rejects.toThrow("草稿和图片已保留");
  expect(postJson).not.toHaveBeenCalled();
});
test("image-capable runtimes receive the exact session and attachment paths", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ capabilities: { acpImages: true } }),
    })),
  );
  await acpPrompt("connection", "session", "", ["/uploads/a.png"]);
  expect(postJson).toHaveBeenCalledWith("/api/acp/prompt", {
    connection_id: "connection",
    session_id: "session",
    text: "",
    image_paths: ["/uploads/a.png"],
  });
});
