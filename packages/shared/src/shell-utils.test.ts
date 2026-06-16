import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shellQuote, formatWorkingDirectory } from "./shell-utils.js";

describe("shellQuote", () => {
  it("wraps simple value in single quotes", () => {
    assert.equal(shellQuote("hello"), "'hello'");
  });

  it("escapes single quotes inside value", () => {
    assert.equal(shellQuote("it's"), "'it'\\''s'");
  });

  it("handles empty string", () => {
    assert.equal(shellQuote(""), "''");
  });

  it("preserves special characters", () => {
    assert.equal(shellQuote("$HOME/path"), "'$HOME/path'");
  });

  it("handles path with spaces", () => {
    assert.equal(shellQuote("/path/to/my folder"), "'/path/to/my folder'");
  });
});

describe("formatWorkingDirectory", () => {
  it("returns bare ~ for tilde alone", () => {
    assert.equal(formatWorkingDirectory("~"), "~");
  });

  it("returns bare ~ for ~/", () => {
    assert.equal(formatWorkingDirectory("~/"), "~");
  });

  it("preserves ~/ prefix with quoted segments", () => {
    assert.equal(formatWorkingDirectory("~/my project"), "~/'my project'");
  });

  it("quotes each segment under ~/", () => {
    assert.equal(formatWorkingDirectory("~/code"), "~/'code'");
  });

  it("quotes absolute paths", () => {
    assert.equal(formatWorkingDirectory("/opt/my app"), "'/opt/my app'");
  });

  it("quotes relative paths", () => {
    assert.equal(formatWorkingDirectory("./src"), "'./src'");
  });

  it("quotes all segments under ~/ in nested paths", () => {
    assert.equal(
      formatWorkingDirectory("~/code/my project/src"),
      "~/'code'/'my project'/'src'",
    );
  });
});
