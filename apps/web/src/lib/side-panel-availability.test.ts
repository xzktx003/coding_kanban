import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isVsCodeAvailable } from "./side-panel-availability.js";

describe("isVsCodeAvailable", () => {
  it("allows vscode for focused ssh sessions", () => {
    assert.equal(
      isVsCodeAvailable({
        panelAvailable: true,
        focusedSession: {
          sshTarget: {
            host: "10.30.0.24",
            port: 10022,
            username: "zukang.xu",
          },
        },
      }),
      true,
    );
  });
});
