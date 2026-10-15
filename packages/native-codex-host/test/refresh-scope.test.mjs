import test from "node:test";
import assert from "node:assert/strict";
import { validateNativeScope } from "../refresh-prototype/native-scope.mjs";

const scope = {
  domain: "019aabcd-1234-7890-abcd-000000000001",
  generation: "019aabcd-1234-7890-abcd-000000000002",
  pid: 42,
  startTicks: "1234567890",
};

test("native identity captures immutable scalar scope independently of caller mutations", () => {
  const input = { ...scope };
  const captured = validateNativeScope(input);
  input.generation = "019aabcd-1234-7890-abcd-000000000003";
  input.pid = 43;
  assert.deepEqual(captured, scope);
  assert.throws(() => {
    captured.pid = 44;
  }, TypeError);
});

test("native identity rejects missing, extra, coercible and ambiguous identity fields", () => {
  const missing = { ...scope };
  delete missing.startTicks;
  for (const invalid of [
    null,
    [],
    missing,
    { ...scope, account: "untrusted" },
    { ...scope, domain: scope.domain.toUpperCase() },
    { ...scope, generation: scope.generation + "\n" },
    { ...scope, pid: "42" },
    { ...scope, pid: 1 },
    { ...scope, pid: 42.1 },
    { ...scope, pid: Number.MAX_SAFE_INTEGER + 1 },
    { ...scope, startTicks: 123 },
    { ...scope, startTicks: "01" },
    { ...scope, startTicks: "-1" },
    { ...scope, startTicks: "123\n" },
    { ...scope, startTicks: "123456789012345678901" },
  ])
    assert.throws(
      () => validateNativeScope(invalid),
      /exact native service scope/,
    );
});
