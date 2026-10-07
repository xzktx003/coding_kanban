# Coding Kanban Design System

## Product and working scene

Product register. Developers work for hours at a desktop in changing daylight and check running jobs from a phone. Preserve the current dark graphite workspace and warm sand accent, and respect the existing optional Session accent themes; do not force a new light/dark preference.

## Color and meaning

Use existing CSS tokens (`--background`, `--card`, `--foreground`, `--muted-foreground`, `--primary`, `--border`, `--ring`) in Session mode. Use existing terminal theme variables in terminal mode. Define new shared colors in OKLCH when needed. Restrained color strategy: neutral surfaces, warm accent for the selected session/input target and primary action, semantic warning/error/success colors only alongside text or an icon. No decorative gradients, neon, gradient text or heavy colored side stripes.

## Typography and rhythm

Use the installed/system sans stack, Chinese system fallback, and the current monospace stack for terminal/code/paths. Ordinary text 13–14px; supporting labels at least 12px; page headings 18–22px. Names are the primary row text, status comes next, path/time secondary. Long names and paths truncate with accessible full context; prose max 75ch. Use a 4px spacing scale, 8px intra-row gaps, 12–16px section padding.

## Components and layout

Compact standard buttons and lists, consistent radii 6–10px, a subtle full border for panels. Avoid nested cards. A row has one clear opening action and separate secondary controls. Current input target has a visible label and full border; inactive panes stay quiet. Data-heavy surfaces use flexible space rather than blank hero regions. Selected, hover, focus, disabled, loading, error and empty states must be distinct.

## Interaction

Name every icon button. Maintain visible keyboard focus. Native buttons/links or complete keyboard semantics for actionable rows; avoid nested buttons. Esc closes the current dialog/menu and focus returns to its trigger. Search presents matched counts and a useful no-results message. A collapsed group must not hide search matches. Preserve stable session IDs, grouping and persisted data. Show destructive consequences and follow existing confirmation rules.

## Responsive and continuity

Desktop retains multi-pane working context. Narrow layouts wrap tools and constrain panel overflow. Phones use at least 44px touch targets for primary and frequent actions, with secondary actions in a named menu. No document horizontal overflow or obscured input. Preserve terminal mount keys, PTY/WebSocket connections and scroll/input state across visual changes.

## Motion and feedback

Use motion only for progress and state transitions, generally 120–180ms. Respect reduced motion; never animate layout or force scroll while the user reads history. Loading, offline, failed recovery and actual empty results each have specific language and a safe retry or next action. UI retries must not implicitly restart, reclaim or resend Agent tasks.

## Verification

Use deterministic synthetic sessions at the live LAN frontend for screenshots and interaction checks. Cover 1440px desktop, 900px narrow, 375px phone; long Chinese names/paths, many sessions, empty/loading/offline/error states and keyboard focus. Changes to recovery, command execution, protocol or state meaning require the user's specific confirmation.

## Workbench control vocabulary

Session and terminal use the same two-position mode switch, with a track, persistent labels and a clear divider before feature navigation. Project-list triggers use a folder plus project context, separate from conversation tabs. Selected tabs use a subtle background and bottom line, not a heavy ring. Restore focus after controlled drawers and mode switches; update status belongs inside the terminal toolbar. Detail and screenshot acceptance: [Workbench UI polish](docs/workbench-ui-polish.md).
