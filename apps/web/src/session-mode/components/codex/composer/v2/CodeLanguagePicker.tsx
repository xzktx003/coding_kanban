import { useMemo, useState } from "react";
import {
  CODE_BLOCK_LANGUAGES,
  canonicalCodeLanguage,
  codeLanguageLabel,
  detectCodeLanguage,
} from "./codeLanguages";

export function CodeLanguagePicker({
  index,
  language,
  code,
  onChange,
}: {
  index: number;
  language: string;
  code: string;
  onChange: (language: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const canonical = canonicalCodeLanguage(language);
  const auto = canonical === "" || canonical === "auto";
  const detected = auto ? detectCodeLanguage(code) : null;
  const detectedLabel = detected ? codeLanguageLabel(detected) : "";
  const buttonLabel = auto
    ? detected
      ? detected === "plaintext"
        ? "自动（纯文本）"
        : `自动（${detectedLabel}）`
      : "自动检测"
    : canonical === "plaintext"
      ? "纯文本"
      : codeLanguageLabel(canonical);
  const aria = auto
    ? detected
      ? `代码语言：自动（${detected === "plaintext" ? "纯文本" : detectedLabel}）`
      : "代码语言：自动检测"
    : `代码语言：${buttonLabel}`;
  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      CODE_BLOCK_LANGUAGES.filter((item) => {
        if (item.value === "plaintext") return false;
        if (!needle) return true;
        return (
          item.label.toLowerCase().includes(needle) ||
          item.value.includes(needle)
        );
      }),
    [needle],
  );
  const showAuto = !needle || "自动检测".includes(query.trim()) || "auto".includes(needle);
  const showPlain =
    !needle || "纯文本".includes(query.trim()) || "plaintext".includes(needle);

  return (
    <div className="session-code-language">
      <button
        type="button"
        aria-label={aria}
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
        }}
      >
        {buttonLabel}
      </button>
      {open && (
        <div className="session-code-language-menu" role="listbox" aria-label="代码语言">
          <input
            aria-label="搜索语言"
            placeholder="搜索语言"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {showAuto && (
            <button type="button" role="option" aria-selected={auto} onClick={() => { onChange(""); setOpen(false); }}>
              自动检测
            </button>
          )}
          {showPlain && (
            <button
              type="button"
              role="option"
              aria-selected={!auto && canonical === "plaintext"}
              onClick={() => { onChange("plaintext"); setOpen(false); }}
            >
              纯文本
            </button>
          )}
          {matches.map((item) => (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={!auto && canonical === item.value}
              onClick={() => { onChange(item.value); setOpen(false); }}
            >
              {item.label}
            </button>
          ))}
          {!showAuto && !showPlain && matches.length === 0 && (
            <p role="status">未找到语言</p>
          )}
        </div>
      )}
      <span className="sr-only">代码块 {index}</span>
    </div>
  );
}
