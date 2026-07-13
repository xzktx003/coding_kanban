import assert from "node:assert/strict";
import test from "node:test";

import { formatSessionLaunchError } from "./session-launch-error.js";

test("session launch errors preserve an actionable backend message", () => {
  assert.equal(
    formatSessionLaunchError(
      new Error("远程服务器未找到 claude，请先安装或配置交互式 shell PATH"),
      "remote claude",
    ),
    "创建失败：远程服务器未找到 claude，请先安装或配置交互式 shell PATH",
  );
});

test("session launch errors fall back to the session name for unknown rejections", () => {
  assert.equal(
    formatSessionLaunchError({ reason: "unknown" }, "remote shell"),
    "创建失败：remote shell",
  );
});
