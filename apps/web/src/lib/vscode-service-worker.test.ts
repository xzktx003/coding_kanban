import assert from "node:assert/strict";
import test from "node:test";

import { checkVsCodeWebServiceWorker } from "./vscode-service-worker.js";

test("classifies TLS certificate failures before mounting VS Code webviews", async () => {
  const result = await checkVsCodeWebServiceWorker({
    isSecureContext: true,
    serviceWorker: {
      async register() {
        throw new DOMException(
          "An SSL certificate error occurred when fetching the script.",
          "SecurityError",
        );
      },
    },
  });

  assert.deepEqual(result, {
    state: "blocked",
    reason: "certificate",
    detail: "An SSL certificate error occurred when fetching the script.",
  });
});

test("unregisters a successful probe worker immediately", async () => {
  let unregisterCalls = 0;
  const result = await checkVsCodeWebServiceWorker({
    isSecureContext: true,
    serviceWorker: {
      async register() {
        return {
          async unregister() {
            unregisterCalls += 1;
            return true;
          },
        };
      },
    },
  });

  assert.deepEqual(result, { state: "ready" });
  assert.equal(unregisterCalls, 1);
});
