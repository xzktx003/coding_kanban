import { expect, it } from "vitest";
import {
  admitProviderTranscriptRows,
  ProviderTranscriptAdmissionError,
} from "./providerTranscriptBudget";
import { estimateTranscriptBytes } from "./codexTranscriptMemoryBudget";

it("keeps the recent window bounded while retaining unresolved permission identities", () => {
  const approval = {
    type: "permission_request",
    requestId: "preserved",
    toolInput: { path: "/project" },
  };
  const rows = [
    approval,
    ...Array.from({ length: 700 }, (_, n) => ({
      uuid: String(n),
      text: `reply ${n} ${"x".repeat(20_000)}`,
    })),
  ];
  const result = admitProviderTranscriptRows(rows, {
    pinned: (row) => "requestId" in row,
  });
  expect(result.rows).toContain(approval);
  expect(result.rows.at(-1)).toBe(rows.at(-1));
  expect(result.rows.length).toBeLessThanOrEqual(600);
  expect(estimateTranscriptBytes(result.rows)).toBeLessThanOrEqual(
    8 * 1024 * 1024,
  );
  expect(result.trimmed).toBe(true);
});

it("keeps the requested earlier edge instead of immediately dropping newly paged history", () => {
  const rows = Array.from({ length: 700 }, (_, n) => ({
    uuid: String(n),
    text: "small reply",
  }));
  const result = admitProviderTranscriptRows(rows, { edge: "earlier" });
  expect(result.rows[0]).toBe(rows[0]);
  expect(result.rows.at(-1)).toBe(rows[599]);
});

it("returns unchanged rows by identity and rejects an irreducible oversized latest item before publication", () => {
  const rows = [{ id: "small", text: "retained" }];
  expect(admitProviderTranscriptRows(rows).rows).toBe(rows);
  const oversized = [{ id: "attachment", data: "x".repeat(9 * 1024 * 1024) }];
  expect(() => admitProviderTranscriptRows(oversized)).toThrow(
    ProviderTranscriptAdmissionError,
  );
});
