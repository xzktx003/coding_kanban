import AceEditor from "react-ace";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-sh";
import "ace-builds/src-noconflict/mode-rust";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-c_cpp";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/mode-css";
import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/theme-monokai";
const modes: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  bash: "sh",
  go: "golang",
  cpp: "c_cpp",
  c: "c_cpp",
};
export default function CodeBlockEditor({
  id,
  value,
  language,
  onChange,
  onSelection,
}: {
  id: string;
  value: string;
  language: string;
  onChange: (s: string) => void;
  onSelection?: (start: number, end: number) => void;
}) {
  const mode =
    modes[language] ??
    ([
      "typescript",
      "javascript",
      "python",
      "json",
      "sh",
      "rust",
      "golang",
      "c_cpp",
      "html",
      "css",
      "sql",
      "yaml",
      "markdown",
    ].includes(language)
      ? language
      : "text");
  return (
    <AceEditor
      name={`draft-code-${id}`}
      aria-label="代码内容"
      mode={mode}
      theme="monokai"
      value={value}
      onChange={onChange}
      onSelectionChange={(selection) => {
        const range = selection.getRange();
        onSelection?.(
          selection.session.doc.positionToIndex(range.start),
          selection.session.doc.positionToIndex(range.end),
        );
      }}
      width="100%"
      minLines={3}
      maxLines={18}
      fontSize={16}
      showPrintMargin={false}
      setOptions={{
        useWorker: false,
        tabSize: 2,
        newLineMode: value.includes("\r\n") ? "windows" : "unix",
        enableBasicAutocompletion: false,
      }}
      editorProps={{ $blockScrolling: true }}
      onLoad={(editor) => {
        editor.textInput.getElement().setAttribute("aria-label", "代码内容");
      }}
    />
  );
}
