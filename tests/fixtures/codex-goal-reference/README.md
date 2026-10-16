# Official Goal component fixture

This fixture serves the repository's unchanged official VSIX assets. It never starts Codex, reads login state, connects to CLI IPC, or sends a real turn. `acquireVsCodeApi` only records messages in a local browser array. It is a component oracle, not an authenticated VS Code host.

Start from the repository root:

```sh
node scripts/codex-goal-reference-server.mjs --host 0.0.0.0 --port 0
```

The OS chooses a free port; the process prints its HTTP LAN URLs. Set `CODEX_GOAL_REFERENCE_URL` to one printed `native-goal.html` URL, and `PLAYWRIGHT_BASE_URL` to an isolated application frontend bound to `0.0.0.0`. Match `PLAYWRIGHT_FRONTEND_PROTOCOL` to that frontend:

```sh
PLAYWRIGHT_SKIP_WEBSERVER=1 pnpm exec playwright test \
  tests/e2e/session-goals-reference.spec.ts \
  tests/e2e/session-goals-completion.spec.ts \
  tests/e2e/session-goals.spec.ts
```

`/reference.json` reports the official package version and SHA-256 of all pinned entry assets. `--extension /absolute/path/to/extension` selects an explicitly supplied package with those exact asset names. A different official build fails at startup instead of silently testing an obsolete component.

`native-goal-reference.js` initializes the original exports and renders the actual card and dialogs. `native-goal-draft-reference.js` and `native-goal-completion-reference.js` use the exact extracted `awa` / `lx` bodies with original exported icon, formatter and Intl primitives; they do not run the full official composer or assistant renderer. Symbol bindings are pinned to `26.51007.21434` and must be audited on upgrades. No official asset is patched.

The reference tests compare six statuses, text, action icons, geometry, two themes, editor and replacement dialogs. Touch tests preserve a separate 44px usability requirement. Without `CODEX_GOAL_REFERENCE_URL`, reference-only cases explicitly skip and cannot be counted as parity acceptance.

`session-goal-control-styles-reference.spec.ts` additionally compares actual per-corner shapes/radii, keyboard focus, pointer hover and the editor's real pending Save state. Pending close stays keyboard-focusable; actual close clicks, Escape and outside clicks must retain the same dialog, draft and single request. Run it against these same isolated URLs with `pnpm exec playwright test --config playwright.goal-controls.config.ts --workers=1`. The config starts no service. `GOAL_CONTROL_STYLE_BROWSER=firefox` selects Firefox; `GOAL_CONTROL_STYLE_EXPECT_CAPABILITY=supported|unsupported` requires the browser's real `CSS.supports` result. The fixture-only client holds one precise GoalSet Promise and denies native host writes; this is not a real native GoalSet receipt or authenticated-host acceptance. See [the scoped evidence and limits](../../../docs/designs/session-render-alignment/goal-controls-style-parity-20261016.md).
