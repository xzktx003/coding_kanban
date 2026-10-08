import { ComposerSuggestionPopover } from "@session/components/codex/composer/ComposerSuggestionPanel";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { defaultStyles, FileIcon } from "react-file-icon";
import type { ComposerEditorRef } from "@session/components/common/useComposerPopover";
import {
  applyEditorReplacement,
  detectAtMention,
  replaceAtTrigger,
  useComposerPopover,
} from "@session/components/common/useComposerPopover";
import { Button } from "@session/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@session/components/ui/popover";
import { isTauri } from "@session/hooks/runtime";
import { searchFiles } from "@session/services/apiAdapt/filesystem";
import { useWorkspaceStore } from "@session/stores";

interface FileItem {
  name: string;
  path: string;
  relativePath: string;
}

interface FileMentionPopoverProps {
  input: string;
  setInput: (v: string) => void;
  editorRef: ComposerEditorRef;
  triggerElement: HTMLElement | null;
  onFileSelected?: (path: string) => void;
}

const getExtension = (name: string) => {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
};

export function FileMentionPopover({
  input,
  setInput,
  editorRef,
  triggerElement,
  onFileSelected,
}: FileMentionPopoverProps) {
  const { cwd } = useWorkspaceStore();
  const [fileResults, setFileResults] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const triggerSpanRef = useRef<HTMLSpanElement | null>(null);

  const handleSelect = useCallback(
    (file: FileItem) => {
      const { cwd: currentCwd } = useWorkspaceStore.getState();
      if (!currentCwd) return;
      const toPosix = (v: string) => v.replace(/\\/g, "/");
      const normalizedCwd = toPosix(currentCwd).replace(/\/+$/, "");
      const normalizedPath = toPosix(file.path);
      const relativePath =
        normalizedCwd && normalizedPath.startsWith(`${normalizedCwd}/`)
          ? normalizedPath.slice(normalizedCwd.length + 1)
          : normalizedPath;
      const link = onFileSelected ? "" : `\`${relativePath}\``;
      const newValue = replaceAtTrigger(input, "@", link);
      if (newValue !== null)
        applyEditorReplacement(newValue, setInput, editorRef);
      else editorRef.current?.focus();
      onFileSelected?.(file.path);
    },
    [input, setInput, editorRef, onFileSelected],
  );

  const {
    open,
    setOpen,
    query,
    filteredItems,
    selectedIndex,
    setSelectedIndex,
    itemRefs,
  } = useComposerPopover({
    input,
    items: fileResults,
    detect: detectAtMention,
    onKeySelect: handleSelect,
  });

  // Search files via backend whenever open or query changes
  useEffect(() => {
    if (!open || !cwd) return;
    let isActive = true;

    const doSearch = async () => {
      setLoading(true);
      try {
        const toPosix = (v: string) => v.replace(/\\/g, "/");
        const normalizedCwd = toPosix(cwd).replace(/\/+$/, "");
        const entries = await searchFiles({
          root: cwd,
          query,
          excludeFolders: [],
          maxResults: 50,
        });
        if (!isActive) return;
        setFileResults(
          entries.map((e) => {
            const normalizedPath = toPosix(e.path);
            const relativePath = normalizedPath.startsWith(`${normalizedCwd}/`)
              ? normalizedPath.slice(normalizedCwd.length + 1)
              : normalizedPath;
            return { name: e.name, path: e.path, relativePath };
          }),
        );
      } catch (error) {
        console.error("Failed to search files:", error);
      } finally {
        if (isActive) setLoading(false);
      }
    };

    const timer = setTimeout(
      () => {
        void doSearch();
      },
      query ? 150 : 0,
    );
    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [open, cwd, query]);

  const shouldUseSvgFileIcon = isTauri();

  if (!open) return null;
  return (
    <ComposerSuggestionPopover
      anchor={triggerElement}
      kind="files"
      count={loading ? 1 : filteredItems.length}
    >
      <div className="overflow-y-auto flex-1 py-1">
        {loading ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            Loading...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            No files found
          </div>
        ) : (
          filteredItems.map((file, index) => {
            const extension = getExtension(file.name);
            const iconStyle =
              extension && extension in defaultStyles
                ? defaultStyles[extension as keyof typeof defaultStyles]
                : defaultStyles.txt;
            return (
              <Button
                key={file.path}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                variant={index === selectedIndex ? "secondary" : "ghost"}
                className="composer-suggestion-option w-full justify-start gap-2 min-h-11 py-1.5 px-3 text-xs rounded-none"
                onClick={() => handleSelect(file)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className="shrink-0 w-4 h-4 flex items-center justify-center">
                  {shouldUseSvgFileIcon ? (
                    <FileIcon extension={extension} color={iconStyle.color} />
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  )}
                </span>
                <span className="font-medium truncate">{file.name}</span>
                <span className="ml-auto text-muted-foreground truncate max-w-[120px] text-right shrink-0">
                  {file.relativePath.includes("/")
                    ? file.relativePath.slice(
                        0,
                        file.relativePath.lastIndexOf("/"),
                      )
                    : ""}
                </span>
              </Button>
            );
          })
        )}
      </div>
    </ComposerSuggestionPopover>
  );
}
