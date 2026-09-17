# File Browser Architecture

## Goal

Add a MobaXterm-style file browser to the orchestrator UI without disturbing
the existing agent-grid and focus-session flows.

## Backend

### Shared contracts

`packages/shared/src/index.ts` now exports filesystem DTOs for:

- `FileEntry`
- `ListFilesInput` / `ListFilesResponse`
- `FilePreviewInput` / `FilePreviewResponse`
- `FileOperationInput`
- `ChmodInput`
- `FileUploadResponse`

### Services

`apps/server/src/services/local-fs-service.ts`

- Reads local directories with metadata
- Previews text/binary files
- Creates, renames, deletes, uploads, downloads, and chmods local paths

`apps/server/src/services/sftp-service.ts`

- Maintains cached `ssh2` client connections keyed by `user@host:port`
- Resolves `~` to the remote home directory
- Supports list / mkdir / rename / delete / preview / download / upload / chmod

`apps/server/src/services/file-system-utils.ts`

- Centralizes path-safety checks
- Formats POSIX permission strings
- Detects file kinds and basic MIME types

### Routes

`apps/server/src/routes/filesystem.ts`

- `POST /api/fs/list`
- `POST /api/fs/operation`
- `POST /api/fs/preview`
- `POST /api/fs/chmod`
- `POST /api/fs/download`
- `POST /api/fs/upload`

All filesystem routes branch on `sshTarget` and map common failures into
HTTP 400 / 403 / 404 / 500 responses.

### App wiring

`apps/server/src/app.ts` now registers the filesystem routes and constructs
the local/SFTP services during server startup.

## Frontend

### UI shell

`apps/web/src/components/FileBrowserDrawer.tsx`

- Drawer host selector
- Toolbar actions
- Breadcrumb navigation
- Lazy directory tree
- Sortable file list
- Preview panel
- Rename / editor / chmod dialogs
- Context menu
- Drag-and-drop upload zone

`apps/web/src/lib/use-file-browser.ts`

- Owns browser state
- Calls real backend APIs
- Tracks selection, sorting, filtering, preview, upload progress, and actions

`apps/web/src/lib/api.ts`

- Adds filesystem request helpers for list / operation / preview / chmod /
  download / upload

### App integration

`apps/web/src/App.tsx`

- Mounts the file browser drawer alongside the existing main content area
- Keeps the current grid/focus view behavior unchanged

`apps/web/src/components/BottomBar.tsx`

- Adds the `📁 文件` toggle entry point

## Testing

### Server

- `apps/server/src/services/local-fs-service.test.ts`
- `apps/server/src/routes/filesystem.test.ts`
- `apps/server/src/services/copilot-binary.test.ts`
- `apps/server/src/services/terminal-control-filter.test.ts`

### Browser

- `tests/e2e/file-browser.spec.ts`

This Playwright flow exercises:

- drawer open
- directory navigation
- hidden-file toggle
- create folder
- rename
- text preview and edit
- image preview
- upload
- download
- delete

### Regression evidence

The full Playwright suite must stay green so the file browser does not regress
existing terminal, discovery, tmux, and window-capture flows.

图片预览使用独立的 `POST /api/fs/image` 流式接口，不把 `/api/fs/preview`
返回的有界二进制前缀拼成 Data URL。本地文件通过受校验路径读取，远端文件
通过已登记的 SSH/SFTP 目标读取；接口仅接受已知图片 MIME，单张限制 16 MiB。
桌面和手机端共享 `FileImagePreview`，以 Blob URL 展示完整图片并在卸载时释放。
