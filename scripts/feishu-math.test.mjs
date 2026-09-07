import assert from "node:assert/strict";
import test from "node:test";
import { findFormulas, replaceFormulas } from "./feishu-math.mjs";

test("finds inline and block math in all four delimiters", () => {
  const text = String.raw`Inline $x^2$ and \(y_i\). Block $$\frac{a}{b}$$ and \[z=1\].`;
  assert.deepEqual(findFormulas(text), [
    "x^2",
    "y_i",
    String.raw`\frac{a}{b}`,
    "z=1",
  ]);
});
test("leaves code fences, inline code, escaped dollars and prices unchanged", () => {
  const text =
    "```latex\n$x$\n```\n~~~\n$y$\n~~~\n`$z$` and ``$w$`` cost $20 and $30. Escaped \\$a\\$";
  assert.deepEqual(findFormulas(text), []);
});
test("replaces supported formulas in place, retaining failures and source as image alt", () => {
  const text = "Before $x^2$ after.\n$$bad$$";
  assert.equal(
    replaceFormulas(text, new Map([["x^2", "img_test"]])),
    "Before ![x^2](img_test) after.\n$$bad$$",
  );
});
test("deduplicates, preserves unmatched delimiters and ignores invalid image keys", () => {
  assert.deepEqual(findFormulas("$x$ $x$ unmatched $$z"), ["x"]);
  assert.equal(replaceFormulas("$x$", new Map([["x", "https://bad"]])), "$x$");
});
