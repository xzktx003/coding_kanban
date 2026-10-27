# Original full model picker fixture

Used by `tests/e2e/session-model-menu-keyboard.spec.ts`. This is a closed, owned UI host for official VSIX **26.51007.21434** hCa/controller/editor, derived from the retained full-hCa model-notice probe. It is not a CLI, authenticated IDE, or formal Statsig rollout test.

The test serves the existing extracted official webview assets from `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets`. `assets-manifest.json` pins all admitted original files; an absent or changed file fails explicitly. The canonical main asset retains its entire original prefix; only `exports.js` is appended to the HTTP response to expose original component/atom references. Official files on disk are unchanged. The HTML supplies standard mobile viewport metadata; original CSS and components are served unchanged.

`harness.js` mounts original full hCa, controller, editor and supporting providers. `activate-original-rpc.mjs` reuses the original RPC runtime, verifying exact extracted host function hashes; it does not import the extension host, auth APIs, or actual HTTP callbacks. The owned wire policy is bounded and denies unsupported messages. Browser requests are restricted to the owned origin and static fixture/asset paths, and WebSockets close immediately.

`prelude.js` supplies a declared synthetic model catalog, existing fixture thread, read responses, and only these synthetic write responses:

- Fixed fixture thread `thread/settings/update`, admitted model/effort, explicitRequestOnly multi-agent mode, absent/null service tier, and exact known parameter keys.
- Fixed device preference `composer-model-picker-selection-mode-v1` set to model/default, with the original persisted-atom-updated response shape. This performs no disk or real host write.

All task submissions and unknown host/HTTP operations are rejected. The original SDK receives declared synthetic gate 3727129412 and disables storage, telemetry and network; it does **not** establish a formal account gate. Tests obtain final model/effort and focus via observation, not by invoking selection callbacks.

Example, using an already-running LAN frontend (HTTPS :8484):

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 \
PLAYWRIGHT_FRONTEND_PROTOCOL=https \
PLAYWRIGHT_BASE_URL=https://10.30.0.24:8484 \
MODEL_MENU_KEYBOARD_OUTPUT=.dev-runtime/model-menu-current \
pnpm exec playwright test tests/e2e/session-model-menu-keyboard.spec.ts --reporter=line
```

The product page uses the existing isolated Session UX API fixture. No formal service is started/restarted, no login data or CLI IPC is used, and all browser contexts close in finally. Missing original artifacts are a missing prerequisite, never successful acceptance. Runtime evidence/output belongs only under the chosen ignored output directory; permanent test inputs live here.
