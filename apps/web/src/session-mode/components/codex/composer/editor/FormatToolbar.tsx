import { useEffect, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection } from "lexical";
import { formatSelection, type FormatKind } from "./formatSelection";

export function FormatToolbar() {
  const [editor] = useLexicalComposerContext();
  const [open, setOpen] = useState(false);
  const [styles, setStyles] = useState(false);
  const [link, setLink] = useState(false);
  const [href, setHref] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        setOpen(Boolean($isRangeSelection(selection) && !selection.isCollapsed()));
      });
    });
  }, [editor]);

  function apply(kind: FormatKind, url = "") {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || selection.isCollapsed()) return;
      const result = formatSelection(selection.getTextContent(), kind, url);
      if (!result) return;
      if (typeof result !== "string") {
        setError(result.error);
        return;
      }
      setError("");
      setLink(false);
      setStyles(false);
      selection.insertText(result);
    });
  }

  if (!open) return null;
  return (
    <div
      className="session-format-toolbar"
      role="toolbar"
      aria-label="文本格式"
      onMouseDown={(event) => event.preventDefault()}
    >
      <button type="button" onClick={() => apply("bold")}>粗体</button>
      <button type="button" onClick={() => apply("italic")}>斜体</button>
      <button type="button" aria-expanded={styles} onClick={() => setStyles((value) => !value)}>
        文本样式
      </button>
      {styles && (
        <div role="menu">
          <button type="button" onClick={() => apply("paragraph")}>正文</button>
          <button type="button" onClick={() => apply("h1")}>标题 1</button>
          <button type="button" onClick={() => apply("h2")}>标题 2</button>
          <button type="button" onClick={() => apply("h3")}>标题 3</button>
          <button type="button" onClick={() => apply("ul")}>项目符号列表</button>
          <button type="button" onClick={() => apply("ol")}>编号列表</button>
        </div>
      )}
      <button type="button" aria-expanded={link} onClick={() => setLink((value) => !value)}>
        链接
      </button>
      {link && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply("link", href);
          }}
        >
          <label>
            链接地址
            <input
              aria-label="链接地址"
              placeholder="输入或粘贴链接"
              value={href}
              onChange={(event) => setHref(event.target.value)}
            />
          </label>
          <button type="submit">应用</button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
