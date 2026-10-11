import { useEffect, useState } from "react";
import { toast } from "sonner";
import { searchFiles } from "@session/services/apiAdapt/filesystem";
import { useEditorStore } from "@session/stores/useEditorStore";
import { useLayoutStore } from "@session/stores";
import { ComposerSheet } from "./v2/ComposerSheet";

export function FileSearchSheet({
  cwd,
  onClose,
}: {
  cwd: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ name: string; path: string }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void searchFiles({
        root: cwd,
        query,
        excludeFolders: [],
        maxResults: 20,
      })
        .then((entries) => {
          if (!active) return;
          setResults(entries.map((entry) => ({ name: entry.name, path: entry.path })));
          setError(null);
        })
        .catch((failure: unknown) => {
          if (!active) return;
          setResults([]);
          setError(failure instanceof Error ? failure.message : String(failure));
        });
    }, query ? 150 : 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cwd, query]);
  return (
    <ComposerSheet title="搜索文件" description="搜索文件…" onClose={onClose}>
      <input
        className="session-command-search"
        aria-label="搜索文件"
        placeholder="搜索文件…"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      {!error && results.length === 0 && <p role="status">未找到文件</p>}
      <div role="listbox" aria-label="搜索结果">
        {results.map((entry) => (
          <button
            key={entry.path}
            type="button"
            role="option"
            onClick={() => {
              useEditorStore.getState().revealFile(entry.path, cwd);
              const layout = useLayoutStore.getState();
              layout.setActiveRightPanelTab("files");
              layout.setRightPanelOpen(true);
              toast.message(`已打开 ${entry.name}`);
              onClose();
            }}
          >
            {entry.name}
          </button>
        ))}
      </div>
    </ComposerSheet>
  );
}
