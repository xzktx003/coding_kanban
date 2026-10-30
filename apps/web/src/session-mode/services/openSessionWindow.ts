import { v4 as randomUUID } from "uuid";
import { buildUrl, authHeaders } from "@session/hooks/runtime";
import {
  captureCodexOperationScope,
  isCodexOperationScopeCurrent,
} from "./codexOperationScope";
import { SESSION_WINDOW_PARAMETER } from "./sessionWindowContext";
import {
  parseSessionWindowRecord,
  SESSION_WINDOW_INTENTS,
  validateWindowTarget,
  writeSessionWindowIntent,
  type SessionWindowRecord,
  type WindowTarget,
} from "./sessionWindowRecords";

/** The new browser is opened synchronously in the user's gesture. A null return
 * is normal for noopener and does not mean that opening was blocked. */
export function openSessionWindow(target: WindowTarget) {
  validateWindowTarget(target);
  const id = randomUUID(),
    endpoint = buildUrl("/health"),
    connection = JSON.stringify([endpoint, authHeaders()]),
    scope = captureCodexOperationScope();
  const record: SessionWindowRecord = {
    version: 1,
    id,
    createdAt: Date.now(),
    endpoint,
    target: { kind: target.kind, id: target.id, cwd: target.cwd },
    status: "verifying",
  };
  writeSessionWindowIntent(record);
  const url = new URL(window.location.href);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.searchParams.set("mode", "session");
  url.searchParams.set(SESSION_WINDOW_PARAMETER, id);
  window.open(url.href, "_blank", "noopener,noreferrer");
  void import("./sessionWindowVerification")
    .then(async ({ verifySessionWindowTarget }) => {
      try {
        const authority = await verifySessionWindowTarget(record.target);
        if (
          connection !== JSON.stringify([buildUrl("/health"), authHeaders()]) ||
          (record.target.kind === "codex" &&
            !isCodexOperationScopeCurrent(scope))
        )
          throw new Error("Source changed");
        const current = parseSessionWindowRecord(
          localStorage.getItem(SESSION_WINDOW_INTENTS + id),
          id,
        );
        if (
          current?.status === "verifying" &&
          JSON.stringify(current.target) === JSON.stringify(record.target)
        )
          writeSessionWindowIntent({ ...record, status: "ready", authority });
      } catch {
        const current = parseSessionWindowRecord(
          localStorage.getItem(SESSION_WINDOW_INTENTS + id),
          id,
        );
        if (current?.status === "verifying")
          writeSessionWindowIntent({ ...record, status: "failed" });
      }
    })
    .catch(() => {
      try {
        writeSessionWindowIntent({ ...record, status: "failed" });
      } catch {
        /* The new page retains its explicit verification error. */
      }
    });
  return id;
}
