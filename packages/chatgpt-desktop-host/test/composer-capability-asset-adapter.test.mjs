import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { openWebviewArchive } from "../src/assets.mjs";
import {
  createComposerCapabilityAssetAdapter,
  COMPOSER_CAPABILITY_REFERENCE,
} from "../src/composer-capability-asset-adapter.mjs";

const archive = process.env.CHATGPT_COMPOSER_CAPABILITY_ORIGINAL_ASAR;
const hash = (body) => createHash("sha256").update(body).digest("hex");

test("capability asset changes require the exact approved archive and members", () => {
  assert.throws(
    () =>
      createComposerCapabilityAssetAdapter({ archiveSha256: "0".repeat(64) }),
    { code: "COMPOSER_CAPABILITY_UNSUPPORTED_ARCHIVE" },
  );
  const adapter = createComposerCapabilityAssetAdapter({
    archiveSha256: COMPOSER_CAPABILITY_REFERENCE.archiveSha256,
  });
  assert.equal(
    adapter.adapt({
      member: "webview/assets/unrelated.js",
      body: Buffer.from(""),
    }),
    null,
  );
  assert.throws(
    () =>
      adapter.adapt({
        member: COMPOSER_CAPABILITY_REFERENCE.threadMember,
        body: Buffer.from("wrong"),
      }),
    { code: "COMPOSER_CAPABILITY_DIGEST_MISMATCH" },
  );
  assert.throws(
    () =>
      adapter.adapt({
        member: COMPOSER_CAPABILITY_REFERENCE.threadMember,
        body: Buffer.alloc(512 * 1024 + 1),
      }),
    { code: "COMPOSER_CAPABILITY_RESOURCE_LIMIT" },
  );
});

test(
  "fixed original members get unique, bounded, syntactically valid scope and provider adaptations",
  { skip: !archive && "Requires an explicitly supplied pinned Mac archive" },
  async () => {
    const source = await openWebviewArchive({
      asarPath: archive,
      sha256: COMPOSER_CAPABILITY_REFERENCE.archiveSha256,
    });
    const adapter = createComposerCapabilityAssetAdapter({
      archiveSha256: COMPOSER_CAPABILITY_REFERENCE.archiveSha256,
    });
    try {
      for (const [member, expectedHash] of [
        [
          COMPOSER_CAPABILITY_REFERENCE.threadMember,
          COMPOSER_CAPABILITY_REFERENCE.threadSha256,
        ],
        [
          COMPOSER_CAPABILITY_REFERENCE.composerMember,
          COMPOSER_CAPABILITY_REFERENCE.composerSha256,
        ],
      ]) {
        const asset = await source.acquireAsset(member);
        try {
          const original = Buffer.from(asset.body),
            result = adapter.adapt({ member, body: asset.body });
          assert.equal(hash(original), expectedHash);
          assert.equal(result.originalSha256, expectedHash);
          assert.equal(result.adaptedSha256, hash(result.body));
          assert.deepEqual(Buffer.from(asset.body), original);
          assert.ok(result.body.byteLength <= 512 * 1024);
          assert.notEqual(result.adaptedSha256, expectedHash);
          const text = result.body.toString("utf8");
          if (member === COMPOSER_CAPABILITY_REFERENCE.threadMember) {
            assert.equal(
              text.split("__chatgptDesktopComposerScope").length - 1,
              1,
            );
            assert.ok(
              text.includes(
                "hostId:s,conversationId:o,clientThreadId:M,isMain:b",
              ),
            );
            const start = text.indexOf(
                "(0,kj.jsx)(Mv,{...se,__chatgptDesktopComposerScope:",
              ),
              end = text.indexOf(")}):h(se", start);
            assert.ok(start >= 0 && end > start);
            const expression = text.slice(start, end + 1);
            const evaluate = new Function(
              "t",
              "s",
              "o",
              "M",
              "b",
              "kj",
              "Mv",
              "se",
              `return ${expression}`,
            );
            const cache = Array(63).fill(Symbol("unset")),
              jsx = { jsx: (_component, props) => props },
              component = {};
            const render = (hostId, conversationId, clientThreadId, isMain) =>
              evaluate(
                cache,
                hostId,
                conversationId,
                clientThreadId,
                isMain,
                jsx,
                component,
                {},
              ).__chatgptDesktopComposerScope;
            const first = render("local", "thread-a", "client-a", true);
            assert.equal(
              render("local", "thread-a", "client-a", true),
              first,
              "ordinary same-identity rerender must reuse scope",
            );
            const changedHost = render("remote", "thread-a", "client-a", true);
            assert.notEqual(changedHost, first);
            const changedConversation = render(
              "remote",
              null,
              "client-a",
              true,
            );
            assert.notEqual(changedConversation, changedHost);
            const changedClient = render("remote", null, "client-b", true);
            assert.notEqual(changedClient, changedConversation);
            assert.notEqual(
              render("remote", null, "client-b", false),
              changedClient,
            );
            assert.ok(text.includes("function Ej(e){let t=(0,Dj.c)(63),"));
          } else {
            assert.ok(text.includes("browser-composer-capability-entry.mjs"));
            assert.ok(text.includes("(0,Or.c)(264)"));
            assert.ok(
              text.includes("t[256]!==e.__chatgptDesktopComposerScope"),
            );
            assert.ok(text.includes("t[256]=e.__chatgptDesktopComposerScope"));
            assert.ok(text.includes("scope:e.__chatgptDesktopComposerScope"));
            const runFragment = (sourceText) => {
              const injected = sourceText.indexOf(
                  "let __chatgptDesktopHomeScope;",
                ),
                begin =
                  injected >= 0
                    ? injected
                    : sourceText.indexOf("let Ai;t[237]!==Ie"),
                end = sourceText.indexOf(";let ji;", begin);
              assert.ok(begin >= 0 && end > begin);
              const fragment = sourceText.slice(begin, end + 1);
              return new Function(
                "t",
                "e",
                "$",
                "pn",
                "__chatgptDesktopComposerRegistrar",
                "stable",
                "W",
                "Xt",
                "R",
                "U",
                `const Ie=stable,ln=stable,Sn=stable,di=stable,fi=stable,pi=stable,mi=stable,hi=stable,gi=stable,_i=stable,vi=stable,yi=stable,ki=stable;${fragment} return Ai;`,
              );
            };
            const react = {
                jsx: (component, props) => ({ component, props }),
                jsxs: (component, props) => ({ component, props }),
              },
              stable = {},
              provider = {},
              registrar = {};
            const scopeA = {
                hostId: "local",
                conversationId: "a",
                clientThreadId: "1",
                isMain: true,
              },
              scopeB = { ...scopeA, conversationId: "b" },
              scopeBConfirmed = { ...scopeB };
            const execute = (
              fn,
              scope,
              t,
              host = "local",
              client = "draft",
              kind = "new",
              entrypoint = "home",
              conversation = null,
            ) =>
              fn(
                t,
                { __chatgptDesktopComposerScope: scope },
                react,
                provider,
                registrar,
                stable,
                host,
                client,
                { value: { kind, entrypoint } },
                conversation,
              );
            const originalFragment = runFragment(original.toString("utf8")),
              oldCache = Array(257).fill(Symbol("unset"));
            const originalA = execute(originalFragment, scopeA, oldCache),
              originalB = execute(originalFragment, scopeB, oldCache);
            assert.equal(
              originalA,
              originalB,
              "original cache ignores the newly added scope",
            );
            const adaptedFragment = runFragment(text),
              cache = Array(264).fill(Symbol("unset"));
            const first = execute(adaptedFragment, scopeA, cache),
              changed = execute(adaptedFragment, scopeB, cache),
              reconfirmed = execute(adaptedFragment, scopeBConfirmed, cache);
            assert.notEqual(first, changed);
            assert.equal(changed.props.children.at(-1).props.scope, scopeB);
            assert.notEqual(changed, reconfirmed);
            assert.equal(
              reconfirmed.props.children.at(-1).props.scope,
              scopeBConfirmed,
            );
            const home = reconfirmed.props.children.at(-1).props.homeScope;
            assert.deepEqual(home, {
              hostId: "local",
              conversationId: null,
              clientThreadId: "draft",
              isMain: true,
            });
            assert.equal(
              execute(adaptedFragment, scopeBConfirmed, cache),
              reconfirmed,
              "ordinary home rerender retains its scope and cached element",
            );
            const nextHome = execute(
              adaptedFragment,
              scopeBConfirmed,
              cache,
              "local",
              "draft-2",
            );
            assert.notEqual(
              nextHome.props.children.at(-1).props.homeScope,
              home,
            );
            assert.equal(
              nextHome.props.children.at(-1).props.homeScope.clientThreadId,
              "draft-2",
            );
            for (const args of [
              ["local", null, "new", "home", null],
              ["local", "draft", "new", "other", null],
              ["local", "draft", "local", "home", null],
              ["local", "draft", "new", "home", "already-assigned"],
            ]) {
              assert.equal(
                execute(
                  adaptedFragment,
                  scopeBConfirmed,
                  cache,
                  ...args,
                ).props.children.at(-1).props.homeScope,
                null,
              );
            }
          }
          const parsed = spawnSync(
            process.execPath,
            ["--check", "--input-type=module"],
            { input: result.body, encoding: "utf8" },
          );
          assert.equal(parsed.status, 0, parsed.stderr);
        } finally {
          asset.release();
        }
      }
    } finally {
      await source.close();
    }
  },
);
