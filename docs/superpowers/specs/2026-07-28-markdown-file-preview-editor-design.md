# Markdown File Preview And Editor Design

## Goal

Render Markdown files in the file browser while retaining source editing,
explicit save behavior, and the existing double-click editor workflow.

## Interaction

- Selecting `.md` or `.markdown` renders GitHub Flavored Markdown in the file
  browser preview pane.
- Double-clicking a Markdown file opens a large browsing and editing dialog.
- Both inline and dialog surfaces share `Preview`, `Edit`, and `Split` modes.
- Edits update the rendered preview immediately in split mode.
- Disk and SFTP writes happen only when the user presses `Save`.
- Dirty drafts show `未保存`; switching to another file asks before discarding
  the current Markdown draft.
- Non-Markdown text files retain the existing source preview and modal editor.

## Architecture

`MarkdownFilePreview.tsx` is a controlled renderer/editor component.
`MarkdownFileDialog.tsx` provides the double-click large-window shell.
`FileBrowserDrawer.tsx` owns the selected file draft, mode, dirty state, save
request, and inline/dialog coordination. The Markdown modules are lazy-loaded so
the parser is excluded from the initial application bundle.

## Security

- Use `react-markdown` with `remark-gfm` rather than hand-written parsing.
- Do not enable `rehype-raw`; Markdown HTML is not inserted into the DOM.
- Render links with `target="_blank"` and `rel="noopener noreferrer"`.
- Continue using the existing local/SFTP save API and path validation boundary.

## Verification

- Component tests cover GFM, HTML suppression, secure external links, preview,
  edit, split, dirty state, and the large dialog.
- File-browser tests cover case-insensitive Markdown extension recognition.
- Chromium verifies inline README rendering, double-click dialog opening,
  split-mode live updates, and dialog dismissal.
- Frontend tests and workspace builds must pass.
