import assert from "node:assert/strict";
import test from "node:test";

import { buildHostDropdownOptions } from "./HostDropdown.js";

test("new-session host choices append a direct SSH connection entry", () => {
  const options = buildHostDropdownOptions(
    [
      {
        name: "gpu-01",
        host: "10.30.0.24",
        port: 22,
        username: "developer",
        defaultPath: "~/",
      },
    ],
    true,
  );

  assert.deepEqual(
    options.map((option) => ({
      label: option.label,
      type: option.kind === "host" ? option.host.type : option.kind,
    })),
    [
      { label: "本机", type: "local" },
      { label: "gpu-01", type: "ssh" },
      { label: "新增 SSH 连接", type: "manual-ssh" },
    ],
  );
});

test("scan host choices do not expose an incomplete manual SSH target", () => {
  assert.deepEqual(
    buildHostDropdownOptions([], false).map((option) =>
      option.kind === "host" ? option.host.type : option.kind,
    ),
    ["local"],
  );
});
