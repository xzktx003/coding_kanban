import assert from "node:assert/strict";
import { test } from "node:test";

import { validateChmodMode, VALID_CHMOD_PATTERN } from "./file-system-utils.js";

test("validateChmodMode accepts three- and four-digit octal modes", () => {
  assert.equal(VALID_CHMOD_PATTERN.test("600"), true);
  assert.equal(validateChmodMode("600"), 0o600);
  assert.equal(validateChmodMode("0600"), 0o600);
  assert.equal(validateChmodMode("1777"), 0o1777);
});

test("validateChmodMode rejects invalid or unsafe modes", () => {
  for (const mode of ["", "07555", "888", "12a4"]) {
    assert.throws(() => validateChmodMode(mode), /valid octal permission/);
  }

  assert.throws(
    () => validateChmodMode("4777"),
    /cannot combine world-writable with setuid\/setgid/,
  );
});
