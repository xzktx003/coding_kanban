import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createSharedThreadNavigationAssetAdapter } from "../src/shared-thread-navigation-assets.mjs";
const name = "webview/assets/pending-request-item-panel-cef204561ca3.js";
const directory = process.env.CHATGPT_DESKTOP_SIDEBAR_ASSET_DIR;
const originalBytes = () => readFile(join(directory, name.split("/").at(-1)));
test(
  "pinned original approval buttons create the per-view intent before any nudge and retain original decisions",
  { skip: !directory },
  async () => {
    const adapter = createSharedThreadNavigationAssetAdapter({
      archiveSha256:
        "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
    });
    assert.ok(adapter.members.includes(name));
    const original = await originalBytes();
    assert.equal(
      createHash("sha256").update(original).digest("hex"),
      "2a3129cf4465d9d024e07f7d83b7d0c6a6e0cec913babcb68efb523d5434dbd1",
    );
    const adapted = adapter.adapt({ member: name, body: original });
    const s = adapted.body.toString();
    assert.equal((s.match(/\.beginApproval\(/g) ?? []).length, 2);
    assert.ok(s.includes("sendResponse:e=>__kanbanApproval.send(e,`decline`)"));
    assert.ok(
      s.includes(
        "sendResponse:e=>__kanbanApproval.send(e,a.type===`exec`?$r(t,I,N):ei(t))",
      ),
    );
    assert.throws(() =>
      adapter.adapt({ member: name, body: Buffer.from("wrong") }),
    );
  },
);

test(
  "the actual pinned approval and denial closures capture before deferred send and preserve the chosen decision",
  { skip: !directory },
  async () => {
    const adapter = createSharedThreadNavigationAssetAdapter({
      archiveSha256:
        "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95",
    });
    const original = await originalBytes();
    const source = adapter
      .adapt({ member: name, body: original })
      .body.toString();
    for (const [marker, endMarker, selected, expected] of [
      ["H=e=>{", "},t[56]=", null, "decline"],
      ["q=e=>{", "},t[67]=", "accept", "accept"],
      ["q=e=>{", "},t[67]=", "acceptForSession", "acceptForSession"],
    ]) {
      const start = source.indexOf(marker),
        end = source.indexOf(endMarker, start);
      assert.ok(start >= 0 && end > start);
      const expression = source.slice(start, end + 1);
      const events = [];
      let pending;
      const sandbox = {
        __kanbanSharedThreadNavigation: {
          beginApproval(target) {
            events.push(["begin", target]);
            return {
              send: (id, decision) => {
                events.push(["send", id, decision]);
                return Promise.resolve();
              },
            };
          },
        },
      };
      const r = "thread-identity",
        i = "local",
        S = 42,
        a = { type: "exec", callId: "item-identity" },
        I = null,
        N = null;
      const V = (value) => {
        events.push(["nudge"]);
        pending = value;
      };
      const $r = (choice) => choice;
      const ei = (choice) => choice;
      const get = new Function(
        "globalThis",
        "V",
        "r",
        "i",
        "S",
        "a",
        "I",
        "N",
        "$r",
        "ei",
        `let H,q;${expression};return ${marker[0]}`,
      );
      const callback = get(sandbox, V, r, i, S, a, I, N, $r, ei);
      callback(
        selected === null
          ? { onSuccess() {} }
          : { selectedOptionId: selected, onSuccess() {} },
      );
      assert.deepEqual(
        events.map((x) => x[0]),
        ["begin", "nudge"],
      );
      assert.deepEqual(events[0][1], {
        hostId: i,
        threadId: r,
        requestId: S,
        itemId: a.callId,
      });
      await pending.sendResponse(42);
      assert.deepEqual(events[2], ["send", 42, expected]);
    }
  },
);
