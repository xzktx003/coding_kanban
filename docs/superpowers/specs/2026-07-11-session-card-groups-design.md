# Session Card Groups Design

## Goal

Add user-managed session groups to the home Kanban and the maximized-session sidebar. Both views must read the same grouping state, show unassigned cards under `未分组`, and let users move cards between groups.

## Scope

- Add, rename, and delete groups.
- Collapse and expand every configured group and the automatic ungrouped group.
- Move a session to a configured group or back to `未分组` from either view.
- Keep the current flat, virtualized grid until the first group is created.
- Persist group definitions and assignments in browser local storage, consistent with the existing layout persistence model.
- Derive a stable assignment key from durable session transport metadata when available, falling back to the current session id.

Cross-browser/server-side synchronization and automatic semantic classification are outside this iteration.

## Architecture

`apps/web/src/lib/session-groups.ts` owns validation, persistence, stable session keys, immutable state changes, and grouping calculation. `App.tsx` owns the single React state and passes it to both presentation surfaces. The home grid and focus sidebar render the same ordered group model and reuse a shared card menu for assignment changes.

Configured groups retain creation order. `未分组` is a virtual group and always appears last when it has matching sessions. Deleting a group removes its assignments, returning affected sessions to `未分组`.

Collapsed group ids are stored beside group definitions and assignments. The home Kanban and focus sidebar therefore show the same expanded state, and deleting a group removes its stale collapse entry.

## Interaction

- A compact `新建分组` command appears in the home toolbar and focus sidebar header.
- Group headers show the group name and card count. User-created groups expose rename and delete icon controls.
- Every group header includes an accessible disclosure control. Collapsing a group hides only its cards while preserving its name, count, and management controls.
- Each card exposes a group menu listing `未分组`, all configured groups, and a `新建分组` command.
- Existing focus-sidebar drag behavior remains dedicated to terminal monitor placement; group movement uses the menu to avoid ambiguous drops.

## Errors And Recovery

Blank or duplicate group names are rejected in the UI. Corrupt local storage falls back to an empty grouping configuration. Unknown/deleted group assignments are treated as ungrouped. Storage write failures do not block session operation.

## Verification

- Pure tests cover storage normalization, stable keys, create/rename/delete/move behavior, and group ordering.
- Component tests prove the home grid and focus sidebar both render the same groups and assignment controls.
- Web build and test suite must pass.
- Browser verification checks the home grid and focus sidebar at desktop width without overlap or clipped controls.
