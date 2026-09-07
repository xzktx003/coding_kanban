import assert from "node:assert/strict";
import { accessSync } from "node:fs";
import test from "node:test";

import { renderFormulaImages } from "./feishu-math-renderer.mjs";

test("does not start rendering or uploading when there are no formulas", async () => {
  const images = await renderFormulaImages([], {
    createBrowser: async () => assert.fail("browser should not be created"),
    runCommand: async () => assert.fail("lark-cli should not be called"),
  });

  assert.equal(images.size, 0);
});

test("renders unique bounded formulas and uploads message images as bot", async () => {
  const calls = [];
  const rendered = [];
  const formulas = [
    "E=mc^2",
    "E=mc^2",
    "\\frac{a}{b}",
    ...Array.from({ length: 25 }, (_, index) => `x_${index}`),
  ];

  const images = await renderFormulaImages(formulas, {
    renderFormulaToPng: async ({ formula, outputPath }) => {
      rendered.push(formula);
      accessSync(
        outputPath.includes("/")
          ? outputPath.slice(0, outputPath.lastIndexOf("/"))
          : ".",
      );
    },
    runCommand: async (binary, args, options) => {
      calls.push({ binary, args, options });
      assert.equal(options.cwd.startsWith("/tmp/"), true);
      const fileArg = args[args.indexOf("--file") + 1];
      assert.match(fileArg, /^formula-\d+\.png$/);
      return {
        stdout: JSON.stringify({
          ok: true,
          data: { image_key: `img_${calls.length}` },
        }),
        stderr: "",
      };
    },
  });

  assert.equal(rendered.length, 20);
  assert.deepEqual(rendered.slice(0, 3), ["E=mc^2", "\\frac{a}{b}", "x_0"]);
  assert.equal(images.size, 20);
  assert.equal(images.get("E=mc^2"), "img_1");
  assert.equal(images.get("\\frac{a}{b}"), "img_2");
  assert.equal(images.has("x_18"), false);

  const first = calls[0];
  assert.equal(first.binary, "lark-cli");
  assert.deepEqual(first.args.slice(0, 6), [
    "im",
    "images",
    "create",
    "--format",
    "json",
    "--as",
  ]);
  assert.equal(first.args[6], "bot");
  assert.deepEqual(JSON.parse(first.args[first.args.indexOf("--data") + 1]), {
    image_type: "message",
  });
  assert.equal(first.options.env.LARKSUITE_CLI_NO_UPDATE_NOTIFIER, "1");
  assert.equal(first.options.env.LARKSUITE_CLI_NO_SKILLS_NOTIFIER, "1");
});

test("omits formulas that cannot be rendered or uploaded", async () => {
  const images = await renderFormulaImages(["good", "bad", "upload-bad"], {
    renderFormulaToPng: async ({ formula }) => {
      if (formula === "bad") {
        throw new Error("invalid formula");
      }
    },
    runCommand: async (_binary, args) => {
      const file = args[args.indexOf("--file") + 1];
      if (file === "formula-3.png") {
        return { stdout: '{"ok":false}', stderr: "" };
      }
      return {
        stdout: '{"ok":true,"data":{"image_key":"img_good"}}',
        stderr: "",
      };
    },
  });

  assert.deepEqual([...images], [["good", "img_good"]]);
});

test("omits uploads that do not return a usable image_key", async () => {
  const images = await renderFormulaImages(["missing", "blank", "ok"], {
    renderFormulaToPng: async () => {},
    runCommand: async (_binary, args) => {
      const file = args[args.indexOf("--file") + 1];
      if (file === "formula-1.png") {
        return { stdout: '{"ok":true,"data":{}}', stderr: "" };
      }
      if (file === "formula-2.png") {
        return { stdout: '{"ok":true,"data":{"image_key":"   "}}', stderr: "" };
      }
      return {
        stdout: '{"ok":true,"data":{"image_key":"img_ok"}}',
        stderr: "",
      };
    },
  });

  assert.deepEqual([...images], [["ok", "img_ok"]]);
});

test("does not upload when the batch budget is exhausted after rendering", async () => {
  let rendered = 0;
  let uploads = 0;
  const images = await renderFormulaImages(["slow"], {
    timeout: 20,
    renderFormulaToPng: async () => {
      rendered += 1;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    },
    runCommand: async () => {
      uploads += 1;
      return {
        stdout: '{"ok":true,"data":{"image_key":"img_late"}}',
        stderr: "",
      };
    },
  });

  assert.equal(rendered, 1);
  assert.equal(uploads, 0);
  assert.equal(images.size, 0);
});

test("passes the remaining budget to injected renderers and uploads", async () => {
  let renderTimeout = 0;
  const images = await renderFormulaImages(["x"], {
    timeout: 5_000,
    renderFormulaToPng: async ({ timeout }) => {
      renderTimeout = timeout;
    },
    runCommand: async (_binary, _args, options) => {
      assert.ok(options.timeout > 0);
      assert.ok(options.timeout <= 5_000);
      return {
        stdout: '{"ok":true,"data":{"image_key":"img_ok"}}',
        stderr: "",
      };
    },
  });

  assert.ok(renderTimeout > 0);
  assert.ok(renderTimeout <= 5_000);
  assert.equal(images.get("x"), "img_ok");
});

test("passes the remaining budget to browser launch and page work", async () => {
  const browserTimeouts = [];
  const pageTimeouts = [];
  const browser = {
    close: async () => {},
    newContext: async () => ({
      close: async () => {},
      newPage: async () => ({
        evaluate: async () => {},
        locator: () => ({
          evaluate: async (_callback, arg, options) => {
            pageTimeouts.push(options.timeout);
            if (arg === undefined) {
              return { height: 20, width: 40 };
            }
          },
          screenshot: async (options) => {
            pageTimeouts.push(options.timeout);
          },
        }),
        setContent: async (_html, options) => {
          pageTimeouts.push(options.timeout);
        },
        setDefaultTimeout: (timeout) => {
          pageTimeouts.push(timeout);
        },
      }),
      route: async () => {},
    }),
  };

  const images = await renderFormulaImages(["E=mc^2"], {
    timeout: 5_000,
    createBrowser: async (_env, timeout) => {
      browserTimeouts.push(timeout);
      return browser;
    },
    runCommand: async () => ({
      stdout: '{"ok":true,"data":{"image_key":"img_browser"}}',
      stderr: "",
    }),
  });

  assert.equal(images.get("E=mc^2"), "img_browser");
  assert.equal(browserTimeouts.length, 1);
  assert.ok(browserTimeouts[0] > 0);
  assert.ok(browserTimeouts[0] <= 5_000);
  assert.ok(pageTimeouts.length >= 5);
  assert.ok(pageTimeouts.every((timeout) => timeout > 0 && timeout <= 5_000));
});

test("skips browser-rendered formulas that would need illegible scaling", async () => {
  let uploads = 0;
  const browser = {
    close: async () => {},
    newContext: async () => ({
      close: async () => {},
      newPage: async () => ({
        evaluate: async () => {},
        locator: () => ({
          evaluate: async (_callback, arg) => {
            if (arg === undefined) {
              return { height: 10_000, width: 10_000 };
            }
          },
          screenshot: async () => assert.fail("oversized formula should skip"),
        }),
        setContent: async () => {},
        setDefaultTimeout: () => {},
      }),
      route: async () => {},
    }),
  };

  const images = await renderFormulaImages(["E=mc^2"], {
    createBrowser: async () => browser,
    runCommand: async () => {
      uploads += 1;
      return {
        stdout: '{"ok":true,"data":{"image_key":"img_too_small"}}',
        stderr: "",
      };
    },
  });

  assert.equal(images.size, 0);
  assert.equal(uploads, 0);
});

test("requires an injected upload command for non-empty formulas", async () => {
  await assert.rejects(
    renderFormulaImages(["x"], {
      renderFormulaToPng: async () => {},
    }),
    /runCommand/i,
  );
});

test("rejects formulas that exceed the local render limit", async () => {
  let rendered = 0;
  const images = await renderFormulaImages(["x".repeat(4001), "ok"], {
    renderFormulaToPng: async () => {
      rendered += 1;
    },
    runCommand: async () => ({
      stdout: '{"ok":true,"data":{"image_key":"img_ok"}}',
      stderr: "",
    }),
  });

  assert.equal(rendered, 1);
  assert.deepEqual([...images], [["ok", "img_ok"]]);
});
