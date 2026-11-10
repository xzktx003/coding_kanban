import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Code2,
  ExternalLink,
  Folder,
  Link,
  PanelRight,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  createQuickLink,
  readQuickLinks,
  writeQuickLinks,
  LEGACY_QUICK_LINKS_KEY,
  parseQuickLinks,
  type QuickLink,
} from "../lib/quick-links";

interface Props {
  fileBrowserAvailable: boolean;
  fileBrowserOpen: boolean;
  vscodeAvailable: boolean;
  vscodeOpen: boolean;
  onToggleFileBrowser: () => void;
  onToggleVsCode: () => void;
}
export function TerminalContentMenus(props: Props) {
  const [open, setOpen] = useState<"sidebar" | "links" | null>(null);
  const [links, setLinks] = useState<QuickLink[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const sidebarButton = useRef<HTMLButtonElement>(null);
  const linksButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    void readQuickLinks().then(async (next) => {
      if (next.length === 0) {
        try {
          const legacy = parseQuickLinks(localStorage.getItem(LEGACY_QUICK_LINKS_KEY));
          if (legacy.length) {
            next = await writeQuickLinks(legacy);
            localStorage.removeItem(LEGACY_QUICK_LINKS_KEY);
          }
        } catch {
          // Keep the old browser copy if migration cannot reach the gateway.
        }
      }
      if (active) setLinks(next);
    }).catch(() => {});
    const outside = (event: PointerEvent) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !(event.target as Element).closest?.(
          "#terminal-quick-links, #terminal-sidebar-content",
        )
      )
        setOpen(null);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.stopPropagation();
        setOpen(null);
        (open === "sidebar" ? sidebarButton : linksButton).current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    return () => {
      active = false;
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keyboard);
    };
  }, [open]);
  const popoverStyle = (trigger: HTMLButtonElement | null) => {
    const bounds = trigger?.getBoundingClientRect();
    const width = Math.min(
      360,
      (window.visualViewport?.width ?? document.documentElement.clientWidth) -
        24,
    );
    return {
      position: "fixed" as const,
      top: (bounds?.bottom ?? 36) + 8,
      left: Math.max(
        12,
        Math.min(
          bounds?.left ?? 12,
          (window.visualViewport?.width ??
            document.documentElement.clientWidth) -
            width -
            12,
        ),
      ),
      right: "auto",
      width,
    };
  };
  const save = async (next: QuickLink[]) => {
    try {
      setLinks(await writeQuickLinks(next));
      setError("");
      return true;
    } catch {
      setError("无法保存链接，请检查浏览器存储空间或权限");
      return false;
    }
  };
  return (
    <div className="top-bar-context-actions" ref={root}>
      <div className="top-bar-menu">
        <button
          ref={sidebarButton}
          type="button"
          className={`top-bar-action${props.fileBrowserOpen || props.vscodeOpen ? " top-bar-action--active" : ""}`}
          aria-expanded={open === "sidebar"}
          aria-controls="terminal-sidebar-content"
          onClick={() => setOpen(open === "sidebar" ? null : "sidebar")}
        >
          <PanelRight size={15} /> 侧边内容 <ChevronDown size={13} />
        </button>
        {open === "sidebar" &&
          createPortal(
            <div
              id="terminal-sidebar-content"
              style={popoverStyle(sidebarButton.current)}
              className="top-bar-menu-popover"
              aria-label="侧边内容"
            >
              <button
                type="button"
                className={`top-bar-menu-item${props.fileBrowserOpen ? " top-bar-menu-item--active" : ""}`}
                data-testid="file-browser-toggle"
                disabled={!props.fileBrowserAvailable}
                aria-pressed={props.fileBrowserOpen}
                title={
                  props.fileBrowserAvailable
                    ? "打开当前终端的文件浏览器"
                    : "仅在终端聚焦态可用"
                }
                onClick={() => {
                  setOpen(null);
                  props.onToggleFileBrowser();
                }}
              >
                <Folder size={16} />
                <span>文件</span>
              </button>
              <button
                type="button"
                className={`top-bar-menu-item${props.vscodeOpen ? " top-bar-menu-item--active" : ""}`}
                data-testid="vscode-toggle"
                disabled={!props.vscodeAvailable}
                aria-pressed={props.vscodeOpen}
                title={
                  props.vscodeAvailable
                    ? "打开当前终端的 VS Code Web"
                    : "仅在终端聚焦态可用"
                }
                onClick={() => {
                  setOpen(null);
                  props.onToggleVsCode();
                }}
              >
                <Code2 size={16} />
                <span>VS Code</span>
              </button>
            </div>,
            document.body,
          )}
      </div>
      <div className="top-bar-menu">
        <button
          ref={linksButton}
          type="button"
          className="top-bar-action"
          aria-expanded={open === "links"}
          aria-controls="terminal-quick-links"
          onClick={() => setOpen(open === "links" ? null : "links")}
        >
          <Link size={15} />
          快捷链接
          <ChevronDown size={13} />
        </button>
        {open === "links" &&
          createPortal(
            <div
              id="terminal-quick-links"
              style={popoverStyle(linksButton.current)}
              className="top-bar-menu-popover terminal-quick-links"
              aria-label="快捷链接"
            >
              {links.length ? (
                links.map((link, index) => (
                  <div className="terminal-quick-link-row" key={link.url}>
                    <a
                      className="top-bar-menu-item"
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={link.url}
                      onClick={() => setOpen(null)}
                    >
                      <span>
                        <strong>{link.title}</strong>
                        <small>{link.url}</small>
                      </span>
                      <ExternalLink size={14} />
                    </a>
                    <button
                      type="button"
                      className="terminal-link-remove"
                      aria-label={`编辑链接 ${link.title}`}
                      onClick={() => {
                        setEditingUrl(link.url);
                        setTitle(link.title);
                        setUrl(link.url);
                        setAdding(true);
                        setError("");
                      }}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      className="terminal-link-remove"
                      aria-label={`删除链接 ${link.title}`}
                      onClick={() => void save(links.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="terminal-links-empty">
                  添加常用网站，一键在新标签页打开。
                </p>
              )}
              <p className="terminal-links-empty">
                保存在本机 Kanban 数据目录，换浏览器后仍可使用。
              </p>
              {adding ? (
                <form
                  className="terminal-link-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    try {
                      const link = createQuickLink(title, url);
                      if (
                        links.some(
                          (item) =>
                            item.url === link.url && item.url !== editingUrl,
                        )
                      )
                        throw new Error("这个链接已经添加");
                      if (!editingUrl && links.length >= 40)
                        throw new Error("最多保存 40 个快捷链接");
                      if (
                        editingUrl &&
                        !links.some((item) => item.url === editingUrl)
                      )
                        throw new Error("原链接已被删除，请取消后重新添加");
                      const next = editingUrl
                        ? links.map((item) =>
                            item.url === editingUrl ? link : item,
                          )
                        : [...links, link];
                      if (await save(next)) {
                        setEditingUrl(null);
                        setAdding(false);
                        setTitle("");
                        setUrl("");
                      }
                    } catch (failure) {
                      setError(
                        failure instanceof Error
                          ? failure.message
                          : "请输入有效链接",
                      );
                    }
                  }}
                >
                  <label>
                    链接名称
                    <input
                      value={title}
                      maxLength={80}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="例如：DeepSeek Harness"
                    />
                  </label>
                  <label>
                    网址
                    <input
                      autoFocus
                      required
                      type="url"
                      value={url}
                      maxLength={2048}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="http://主机:端口/"
                    />
                  </label>
                  <div>
                    <button
                      type="button"
                      className="top-bar-action"
                      onClick={() => {
                        setAdding(false);
                        setEditingUrl(null);
                        setTitle("");
                        setUrl("");
                        setError("");
                      }}
                    >
                      取消
                    </button>
                    <button type="submit" className="top-bar-action">
                      {editingUrl ? "保存修改" : "保存链接"}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  className="top-bar-menu-item"
                  onClick={() => {
                    setAdding(true);
                    setEditingUrl(null);
                    setTitle("");
                    setUrl("");
                    setError("");
                  }}
                >
                  <Plus size={15} />
                  添加快捷链接
                </button>
              )}
              {error && (
                <p className="terminal-links-error" role="alert">
                  {error}
                </p>
              )}
            </div>,
            document.body,
          )}
      </div>
    </div>
  );
}
