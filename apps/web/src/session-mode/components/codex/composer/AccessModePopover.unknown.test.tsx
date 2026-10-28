import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AccessModePopover } from "./AccessModePopover";
import { changeThreadModel, ensureThreadModelSettings, flushThreadModelSettings, hydrateThreadModel } from "@session/stores/useThreadModelStore";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
it.each(["unknown", "model-only"])("shows %s permissions as unconfirmed with no selected access row", async kind => {
  await ensureThreadModelSettings("permission-ui");
  if (kind === "model-only") { hydrateThreadModel("permission-ui", { model: "native" }); await flushThreadModelSettings("permission-ui"); }
  render(<div className="session-mode"><AccessModePopover threadId="permission-ui" /></div>);
  fireEvent.keyDown(screen.getByRole("button", { name: "执行权限：权限待确认" }), { key: "ArrowDown" });
  const rows = await screen.findAllByRole("menuitemradio");
  for (const row of rows) expect(row.getAttribute("aria-checked")).toBe("false");
});
it("shows full access only after the explicit same-value choice is stored", async () => {
  await ensureThreadModelSettings("permission-ui");
  render(<div className="session-mode"><AccessModePopover threadId="permission-ui" /></div>);
  expect(screen.getByRole("button", { name: "执行权限：权限待确认" })).toBeDefined();
  await act(async () => { changeThreadModel("permission-ui", { sandbox: "danger-full-access", sandboxPolicy: null, approvalPolicy: "never", approvalsReviewer: "user" }); await flushThreadModelSettings("permission-ui"); });
  expect(screen.getByRole("button", { name: "执行权限：完全访问" })).toBeDefined();
});
it("does not label an unobserved reviewer as user approval, and recognizes a later native auto reviewer", async () => {
  await ensureThreadModelSettings("permission-reviewer");
  hydrateThreadModel("permission-reviewer", { model: "native", approvalPolicy: "on-request", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/only"], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
  await flushThreadModelSettings("permission-reviewer");
  render(<div className="session-mode"><AccessModePopover threadId="permission-reviewer" /></div>);
  const trigger = screen.getByRole("button", { name: "执行权限：权限待确认" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  for (const row of await screen.findAllByRole("menuitemradio")) expect(row.getAttribute("aria-checked")).toBe("false");
  await act(async () => { hydrateThreadModel("permission-reviewer", { model: "native", approvalsReviewer: "auto_review" }); await flushThreadModelSettings("permission-reviewer"); });
  expect(trigger.getAttribute("aria-label")).toBe("执行权限：帮我批准");
  expect(screen.getByRole("menuitemradio", { name: /帮我批准/ }).getAttribute("aria-checked")).toBe("true");
});
it("keeps a fully observed native user approval mode selected", async () => {
  await ensureThreadModelSettings("permission-reviewer");
  hydrateThreadModel("permission-reviewer", { model: "native", approvalPolicy: "on-request", approvalsReviewer: "user", sandboxPolicy: { type: "workspaceWrite", writableRoots: ["/only"], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } });
  await flushThreadModelSettings("permission-reviewer");
  render(<div className="session-mode"><AccessModePopover threadId="permission-reviewer" /></div>);
  fireEvent.keyDown(screen.getByRole("button", { name: "执行权限：请求批准" }), { key: "ArrowDown" });
  expect((await screen.findByRole("menuitemradio", { name: /请求批准/ })).getAttribute("aria-checked")).toBe("true");
});
