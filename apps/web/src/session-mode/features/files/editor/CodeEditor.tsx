import { listenInSessionMode } from "@session/session-dom";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Save,
  Search,
  Send,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import AceEditor from "react-ace";
import { Button } from "@session/components/ui/button";
import { Input } from "@session/components/ui/input";
import { useThemeContext } from "@session/contexts/ThemeContext";
import { useEditorStore } from "@session/stores/EditorStore";
// Import Ace Editor modes
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/mode-css";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-java";
import "ace-builds/src-noconflict/mode-c_cpp";
import "ace-builds/src-noconflict/mode-rust";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-php";
import "ace-builds/src-noconflict/mode-ruby";
import "ace-builds/src-noconflict/mode-xml";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/mode-sh";
import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/mode-dockerfile";
import "ace-builds/src-noconflict/mode-ini";
import "ace-builds/src-noconflict/mode-toml";
import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/ext-searchbox";
// Import themes
import "ace-builds/src-noconflict/theme-monokai";
import "ace-builds/src-noconflict/theme-github";
import { aceMapping, editableExtensions } from "./languageMap";

interface CodeEditorProps {
  content: string;
  filePath: string;
  isReadOnly?: boolean;
  onContentChange?: (content: string) => void;
  onSave?: (content: string) => Promise<void>;
  onSelectionChange?: (selectedText: string) => void;
  onSendToAI?: (selectedText: string) => void;
  onAddToTodo?: (selectedText: string) => void;
  className?: string;
}

export function CodeEditor({
  content,
  filePath,
  isReadOnly = false,
  onContentChange,
  onSave,
  onSelectionChange,
  onSendToAI,
  onAddToTodo,
  className = "",
}: CodeEditorProps) {
  const editorId = useId();
  // Local state
  const [editedContent, setEditedContent] = useState(content);
  const [wordWrap, setWordWrap] = useState(true);
  const [gotoLine, setGotoLine] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const currentFilePath = useRef(filePath);
  currentFilePath.current = filePath;
  const savingDraft = useRef<{ path: string; content: string } | null>(null);
  const saveAcknowledgement = useRef<{ path: string; content: string } | null>(
    null,
  );
  const [aceEditor, setAceEditor] = useState<any>(null);
  const [selection, setSelection] = useState<{
    text: string;
    position: { x: number; y: number };
  } | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const searchMarkerRef = useRef<any>(null);

  // Zustand stores
  const { resolvedTheme } = useThemeContext();
  const {
    showLineNumbers,
    fontSize,
    tabSize,
    searchTerm,
    searchResults,
    currentSearchIndex,
    showSearch,
    setSearchTerm,
    setSearchResults,
    setCurrentSearchIndex,
    setShowSearch,
    resetSearch,
    setCursorPosition,
    getCursorPosition,
  } = useEditorStore();

  const getFileExtension = useCallback(() => {
    const fileName = filePath.split("/").pop() || filePath;
    const lastDot = fileName.lastIndexOf(".");
    return lastDot > -1 ? fileName.substring(lastDot + 1).toLowerCase() : "";
  }, [filePath]);

  const getAceMode = useMemo(() => {
    const extension = getFileExtension();
    const name = filePath.split("/").pop()?.toLowerCase() ?? "";
    return aceMapping[extension] || aceMapping[name] || "text";
  }, [getFileExtension]);

  // Determine if we should allow editing based on file extension
  const isEditableFile = true; // Parent accepts only verified UTF-8 text.

  // Update edited content when content prop changes
  useEffect(() => {
    const acknowledgement = saveAcknowledgement.current;
    if (
      acknowledgement?.path === filePath &&
      acknowledgement.content === content
    ) {
      // Disk acknowledged an older snapshot; keep text entered while it saved.
      saveAcknowledgement.current = null;
      return;
    }
    setEditedContent(content);
  }, [content, filePath]);

  useEffect(() => {
    setIsSaving(false);
    setSaveError(null);
  }, [filePath]);

  const handleSave = useCallback(async () => {
    if (
      !onSave ||
      isReadOnly ||
      !isEditableFile ||
      savingDraft.current?.path === filePath
    )
      return;
    const request = { path: filePath, content: editedContent };
    savingDraft.current = request;
    saveAcknowledgement.current = request;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(request.content);
    } catch (error) {
      if (
        currentFilePath.current === request.path &&
        savingDraft.current === request
      ) {
        saveAcknowledgement.current = null;
        setSaveError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (savingDraft.current === request) {
        savingDraft.current = null;
        if (currentFilePath.current === request.path) setIsSaving(false);
      }
    }
  }, [onSave, isReadOnly, isEditableFile, editedContent, filePath]);

  // Handle cursor position tracking
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleAceSelection is declared below and rebuilt every render; depending on it would re-attach the Ace listeners continuously
  useEffect(() => {
    if (!aceEditor) return;

    // Restore cursor position for this file
    const savedPosition = getCursorPosition(filePath);
    if (savedPosition) {
      setTimeout(() => {
        aceEditor.gotoLine(savedPosition.row + 1, savedPosition.column, false);
      }, 100);
    }

    // Add cursor change listener to save position
    const handleCursorChange = () => {
      const cursorPosition = aceEditor.getCursorPosition();
      setCursorPosition(filePath, {
        row: cursorPosition.row,
        column: cursorPosition.column,
      });
    };

    const handleSelectionAndCursor = () => {
      handleCursorChange();
      // Handle text selection for floating toolbar with a small delay
      setTimeout(() => {
        if (aceEditor && typeof aceEditor.getSelectedText === "function") {
          handleAceSelection(aceEditor);
        }
      }, 10);
    };

    aceEditor.on("changeSelection", handleSelectionAndCursor);
    aceEditor.on("changeCursor", handleCursorChange);

    return () => {
      // Save current cursor position when switching files
      if (aceEditor.getCursorPosition) {
        const cursorPosition = aceEditor.getCursorPosition();
        setCursorPosition(filePath, {
          row: cursorPosition.row,
          column: cursorPosition.column,
        });
      }

      // Clean up listeners
      aceEditor.off("changeSelection", handleSelectionAndCursor);
      aceEditor.off("changeCursor", handleCursorChange);
    };
  }, [aceEditor, filePath, getCursorPosition, setCursorPosition]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target instanceof Element &&
          e.target.closest('[role="dialog"], [role="alertdialog"]'))
      )
        return;
      const scope = editorContainerRef.current?.closest(".session-mode");
      if (
        scope?.querySelector(
          '[data-slot="dialog-content"][data-state="open"], [data-slot="alert-dialog-content"][data-state="open"]',
        )
      )
        return;
      // Preserved tool trees must not save files from a hidden page or panel.
      if (editorContainerRef.current?.closest("[hidden], [inert]")) return;
      if (!editorContainerRef.current?.contains(document.activeElement)) return;
      // Ctrl+S or Cmd+S to save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };

    const stopHandleKeyDownForSession = listenInSessionMode(
      document,
      "keydown",
      handleKeyDown,
    );
    return () => {
      stopHandleKeyDownForSession();
    };
  }, [handleSave]);

  const handleContentChange = (newContent: string) => {
    setEditedContent(newContent);
    if (onContentChange) {
      onContentChange(newContent);
    }
  };

  const handleAceLoad = useCallback((editor: any) => {
    setAceEditor(editor);
  }, []);

  const handleAceSelection = (aceEditor: any) => {
    // Check if aceEditor and its methods exist
    if (!aceEditor || typeof aceEditor.getSelectedText !== "function") {
      console.warn("ACE Editor not properly initialized");
      return;
    }

    const selectedText = aceEditor.getSelectedText();

    if (selectedText.trim()) {
      // Get selection position for floating button using ACE's coordinate system
      try {
        const selection = aceEditor.getSelection();
        const range = selection.getRange();
        const renderer = aceEditor.renderer;

        // Get pixel position relative to the editor
        const pixelPos = renderer.textToScreenCoordinates(
          range.end.row,
          range.end.column,
        );

        if (editorContainerRef.current && pixelPos) {
          const containerRect =
            editorContainerRef.current.getBoundingClientRect();
          const editorElement = aceEditor.container;
          const editorRect = editorElement.getBoundingClientRect();

          // Calculate position relative to the container
          const x = pixelPos.pageX - editorRect.left + 10;
          const y = pixelPos.pageY - editorRect.top - 40;

          // Make sure the button stays within bounds
          const maxX = containerRect.width - 100;
          const maxY = containerRect.height - 40;

          const position = {
            x: Math.min(Math.max(10, x), maxX),
            y: Math.max(10, Math.min(y, maxY)),
          };

          setSelection({ text: selectedText, position });
        }
      } catch (error) {
        console.warn("Could not calculate selection position:", error);
        // Fallback to a simple position
        setSelection({ text: selectedText, position: { x: 100, y: 50 } });
      }
    } else {
      setSelection(null);
    }

    if (onSelectionChange) {
      onSelectionChange(selectedText);
    }
  };

  // Search functionality
  const performSearch = useCallback(
    (term: string, targetContent: string) => {
      if (!term.trim()) {
        setSearchResults([]);
        setCurrentSearchIndex(-1);
        return;
      }

      const lines = targetContent.split("\n");
      const results: number[] = [];

      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(term.toLowerCase())) {
          results.push(index);
        }
      });

      setSearchResults(results);
      setCurrentSearchIndex(results.length > 0 ? 0 : -1);
    },
    [setSearchResults, setCurrentSearchIndex],
  );

  const handleSearch = useCallback(
    (term: string) => {
      setSearchTerm(term);
      performSearch(term, editedContent);
    },
    [editedContent, performSearch, setSearchTerm],
  );

  const handleSearchNext = () => {
    if (searchResults.length > 0) {
      const newIndex =
        currentSearchIndex < searchResults.length - 1
          ? currentSearchIndex + 1
          : 0;
      setCurrentSearchIndex(newIndex);
    }
  };

  const handleSearchPrev = () => {
    if (searchResults.length > 0) {
      const newIndex =
        currentSearchIndex > 0
          ? currentSearchIndex - 1
          : searchResults.length - 1;
      setCurrentSearchIndex(newIndex);
    }
  };

  const toggleSearch = () => {
    if (showSearch) {
      resetSearch();
    } else {
      setShowSearch(true);
    }
  };

  // Effect to handle search navigation in Ace Editor
  // biome-ignore lint/correctness/useExhaustiveDependencies: editedContent is read only to locate the term at navigation time; depending on it would re-run the highlight on every keystroke
  useEffect(() => {
    if (
      aceEditor &&
      searchResults.length > 0 &&
      currentSearchIndex >= 0 &&
      showSearch
    ) {
      const targetLine = searchResults[currentSearchIndex];
      aceEditor.gotoLine(targetLine + 1, 0, true);
      aceEditor.scrollToLine(targetLine, true, true, () => {});

      // Highlight search term
      if (searchTerm) {
        try {
          const Range = (window as any).ace?.require("ace/range").Range;
          if (Range) {
            if (searchMarkerRef.current) {
              aceEditor.removeMarker(searchMarkerRef.current);
            }
            const currentContent = editedContent;
            const lines = currentContent.split("\n");
            const line = lines[targetLine];
            const index = line.toLowerCase().indexOf(searchTerm.toLowerCase());
            if (index >= 0) {
              const range = new Range(
                targetLine,
                index,
                targetLine,
                index + searchTerm.length,
              );
              searchMarkerRef.current = aceEditor.addMarker(
                range,
                "ace_selected-word",
                "text",
              );
            }
          }
        } catch (e) {
          console.warn("Could not highlight search term:", e);
        }
      }
    }
  }, [aceEditor, searchResults, currentSearchIndex, searchTerm, showSearch]);

  // Hide floating button when clicking elsewhere or when selection changes
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // Don't hide if clicking on the floating button itself
      if (target.closest("[data-floating-selection-toolbar]")) {
        return;
      }

      if (
        selection &&
        editorContainerRef.current &&
        !editorContainerRef.current.contains(target)
      ) {
        setSelection(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [selection]);

  const currentContent = editedContent;
  const aceTheme = resolvedTheme === "dark" ? "monokai" : "github";

  useEffect(() => {
    if (!aceEditor || typeof aceEditor.setTheme !== "function") return;
    aceEditor.setTheme(`ace/theme/${aceTheme}`);
  }, [aceEditor, aceTheme]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Toolbar */}
      <div
        className={`flex items-center gap-1 p-2 border-b ${resolvedTheme === "dark" ? "border-border bg-card" : "border-gray-200 bg-gray-50"}`}
      >
        {!isReadOnly && isEditableFile && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSave}
            disabled={isSaving}
            className="size-8 p-1"
            title="保存文件（Ctrl+S）"
            aria-label="保存文件（Ctrl+S）"
          >
            <Save className="w-4 h-4" />
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={toggleSearch}
          className="size-8 p-1"
          title="在文件中查找"
          aria-label="在文件中查找"
        >
          <Search className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="查找替换"
          title="查找替换（Ctrl+H）"
          onClick={() => aceEditor?.execCommand("replace")}
        >
          替换
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="自动换行"
          aria-pressed={wordWrap}
          onClick={() => setWordWrap((v) => !v)}
        >
          换行
        </Button>
        <input
          className="session-editor-goto"
          aria-label="跳转行号"
          placeholder="行号"
          inputMode="numeric"
          value={gotoLine}
          onChange={(e) => setGotoLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const line = Number(gotoLine);
              if (Number.isInteger(line) && line > 0) {
                aceEditor?.gotoLine(line, 0, true);
                aceEditor?.focus();
              }
            }
          }}
        />
      </div>

      {saveError && (
        <div
          role="alert"
          className="border-b border-destructive/30 px-3 py-2 text-sm text-destructive"
        >
          保存失败，草稿已保留：{saveError}。请再次点击保存重试。
        </div>
      )}
      {/* Search Bar */}
      {showSearch && (
        <div
          className={`flex items-center gap-2 p-2 border-b ${resolvedTheme === "dark" ? "border-border bg-card" : "border-gray-200 bg-gray-50"}`}
        >
          <Search
            className={`w-4 h-4 ${resolvedTheme === "dark" ? "text-muted-foreground" : "text-gray-400"}`}
          />
          <Input
            type="text"
            placeholder="查找文件内容…"
            aria-label="查找文件内容"
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) {
                  handleSearchPrev();
                } else {
                  handleSearchNext();
                }
              } else if (e.key === "Escape") {
                toggleSearch();
              }
            }}
            className="flex-1 h-8"
            autoFocus
          />
          {searchResults.length > 0 && (
            <div className="flex items-center gap-1">
              <span
                className={`text-xs ${resolvedTheme === "dark" ? "text-muted-foreground" : "text-gray-600"}`}
              >
                {currentSearchIndex + 1} / {searchResults.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSearchPrev}
                className="size-8 p-1"
                title="上一个匹配"
                aria-label="上一个匹配"
              >
                <ChevronUp className="w-3 h-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSearchNext}
                className="size-8 p-1"
                title="下一个匹配"
                aria-label="下一个匹配"
              >
                <ChevronDown className="w-3 h-3" />
              </Button>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSearch}
            className="size-8 p-1"
            title="关闭文件查找"
            aria-label="关闭文件查找"
          >
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-hidden relative" ref={editorContainerRef}>
        {/* Floating Selection Actions */}
        {selection?.text.trim() &&
          selection.position &&
          (onSendToAI || onAddToTodo) && (
            <div
              data-floating-selection-toolbar
              className={`absolute z-10 flex items-center gap-1 p-1 rounded shadow-lg border ${
                resolvedTheme === "dark"
                  ? "bg-card border-border"
                  : "bg-white border-gray-200"
              }`}
              style={{
                left: selection.position.x,
                top: selection.position.y,
                transform: "translateX(-50%)",
              }}
            >
              {onSendToAI && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSendToAI(selection.text);
                    setSelection(null);
                  }}
                  className="size-8 p-1"
                  title="将选中文本放入会话输入框"
                  aria-label="将选中文本放入会话输入框"
                >
                  <Send className="w-4 h-4" />
                </Button>
              )}
              {onAddToTodo && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onAddToTodo(selection.text);
                    setSelection(null);
                  }}
                  className="size-8 p-1"
                  title="将选中文本添加到待办"
                  aria-label="将选中文本添加到待办"
                >
                  <FileText className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}

        <AceEditor
          name={`session-file-${editorId}`}
          mode={getAceMode}
          theme={aceTheme}
          value={currentContent}
          readOnly={isReadOnly || !isEditableFile}
          enableBasicAutocompletion={!isReadOnly && isEditableFile}
          enableLiveAutocompletion={false}
          enableSnippets={false}
          fontSize={fontSize}
          width="100%"
          height="100%"
          showPrintMargin={false}
          showGutter={showLineNumbers}
          highlightActiveLine={!isReadOnly && isEditableFile}
          setOptions={{
            tabSize: tabSize,
            wrap: wordWrap,
            useWorker: false, // Disable worker to avoid console errors
          }}
          onChange={(value) => {
            if (!isReadOnly && isEditableFile) {
              handleContentChange(value);
            }
          }}
          onSelectionChange={(_, editorInstance) => {
            if (
              editorInstance &&
              typeof editorInstance.getSelectedText === "function"
            ) {
              handleAceSelection(editorInstance);
            }
          }}
          onLoad={handleAceLoad}
        />
      </div>
    </div>
  );
}
