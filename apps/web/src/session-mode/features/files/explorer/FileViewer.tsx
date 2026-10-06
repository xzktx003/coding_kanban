import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@session/components/ui/button';
import { useThemeContext } from '@session/contexts/ThemeContext';
import { useDirWatch } from '@session/hooks/useDirWatch';
import { saveFileWithConflictCheck } from '@session/file-save';
import {
  canonicalizePath,
  readTextFile,
  writeFile,
} from '@session/services';
import { useInputStore } from '@session/stores';
import { useTodoStore } from '@session/stores/useTodoStore';
import { getErrorMessage } from '@session/utils/errorUtils';
import { getFilename } from '@session/utils/getFilename';
import { CodeEditor } from '../editor/CodeEditor';
import { OfficeView } from './OfficeView';
import { OFFICE_EXTENSIONS } from './officeFileTypes';

interface FileViewerProps {
  filePath: string;
}

const getFileExtension = (path: string) => {
  const base = getFilename(path);
  const lastDot = base.lastIndexOf('.');
  return lastDot > -1 ? base.substring(lastDot + 1).toLowerCase() : '';
};

export function FileViewer({ filePath }: FileViewerProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const [_, setSelectedText] = useState<string>('');
  const [currentContent, setCurrentContent] = useState<string>('');
  const [diskChanged, setDiskChanged] = useState(false);
  const requestVersion = useRef(0);
  const [canonicalFile, setCanonicalFile] = useState<string | null>(null);
  const { resolvedTheme } = useThemeContext();
  const { setInputValue } = useInputStore();
  const addTodo = useTodoStore((state) => state.addTodo);

  const isOfficeFile = OFFICE_EXTENSIONS.includes(getFileExtension(filePath));

  const loadFile = useCallback(async () => {
    if (isOfficeFile) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);

    try {
      const fileContent = await readTextFile(filePath);

      if (version !== requestVersion.current) return;
      setContent(fileContent);
      setCurrentContent(fileContent);
      setDiskChanged(false);
    } catch (err) {
      if (version === requestVersion.current) setError(getErrorMessage(err));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [filePath, isOfficeFile]);

  // Reset content/error inline during render when filePath becomes falsy
  if (!filePath && (content !== '' || error !== null)) {
    setContent('');
    setError(null);
  }

  useEffect(() => {
    if (!filePath) {
      return;
    }
    let active = true;
    setCanonicalFile(null);
    void loadFile();
    (async () => {
      try {
        const c = await canonicalizePath(filePath);
        if (active) setCanonicalFile(c);
      } catch {
        if (active) setCanonicalFile(filePath);
      }
    })();
    return () => { active = false; requestVersion.current++; };
  }, [filePath, loadFile]);

  useEffect(() => {
    setCurrentContent(content);
  }, [content]);

  const handleSave = async (newContent: string) => {
    if (!filePath) return;

    try {
      await saveFileWithConflictCheck(filePath, content, newContent, readTextFile, writeFile);
      setContent(newContent);
      setCurrentContent(newContent);
      setDiskChanged(false);
    } catch (err) {
      console.error('Failed to save file:', err);
      throw new Error(`Failed to save file: ${err}`);
    }
  };

  const handleSelectionChange = (newSelectedText: string) => {
    setSelectedText(newSelectedText);
  };

  const handleContentChange = (newContent: string) => {
    setCurrentContent(newContent);
  };

  const handleToggleContent = () => {
    setShowFullContent(!showFullContent);
  };

  const MAX_LINES = 500;
  const isLargeFile = content.split('\n').length > MAX_LINES;

  const displayContent = showFullContent
    ? content
    : (() => {
        const lines = content.split('\n');
        if (lines.length <= MAX_LINES) return content;
        return lines.slice(0, MAX_LINES).join('\n');
      })();

  const parentDir = filePath.slice(0, filePath.lastIndexOf('/')) || '/';
  useDirWatch(filePath && !isOfficeFile ? parentDir : null, event => {
    if (event.path !== (canonicalFile || filePath)) return;
    if (currentContent === content) void loadFile();
    else setDiskChanged(true);
  });

  if (!filePath) return null;

  if (isOfficeFile) {
    return <OfficeView filePath={filePath} />;
  }

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Tab-style header — Zed-inspired: tight, no heavy background */}
      <div className="flex-1 overflow-hidden">
        {diskChanged && (
          <div
            className={`px-3 py-2 text-xs flex items-center justify-between ${resolvedTheme === 'dark' ? 'bg-amber-950 text-amber-300' : 'bg-amber-50 text-amber-800'}`}
          >
            <span>磁盘文件已更新，当前草稿已保留。</span>
            <div className="space-x-2">
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2"
                onClick={() => setDiskChanged(false)}
              >
                保留草稿
              </Button>
              <Button variant="default" size="sm" className="h-6 px-2" onClick={loadFile}>
                重新读取
              </Button>
            </div>
          </div>
        )}
        {loading ? (
          <div
            className={`h-full p-6 flex flex-col items-center justify-center gap-4 ${resolvedTheme === 'dark' ? 'text-muted-foreground' : 'text-gray-500'}`}
          >
            <div className="flex items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm font-medium">Loading file...</span>
            </div>
            <div className="w-full max-w-xl space-y-2">
              <div
                className={`h-3 rounded animate-pulse ${resolvedTheme === 'dark' ? 'bg-muted' : 'bg-gray-200'}`}
              />
              <div
                className={`h-3 rounded animate-pulse ${resolvedTheme === 'dark' ? 'bg-muted' : 'bg-gray-200'}`}
              />
              <div
                className={`h-3 rounded w-2/3 animate-pulse ${resolvedTheme === 'dark' ? 'bg-muted' : 'bg-gray-200'}`}
              />
            </div>
          </div>
        ) : error ? (
          <div
            className={`p-4 text-center ${resolvedTheme === 'dark' ? 'text-destructive' : 'text-red-500'}`}
          >
            {error}
          </div>
        ) : (
          <div className="h-full flex flex-col">
            <CodeEditor
              content={displayContent}
              filePath={filePath}
              onContentChange={handleContentChange}
              onSave={handleSave}
              onSelectionChange={handleSelectionChange}
              onSendToAI={(text) => {
                setInputValue(text);
              }}
              onAddToTodo={(text) => {
                addTodo(text);
              }}
              className="flex-1"
            />
            {isLargeFile && !showFullContent && (
              <div
                className={`p-4 text-center border-t ${resolvedTheme === 'dark' ? 'border-border bg-card' : 'border-gray-200 bg-gray-50'}`}
              >
                <p
                  className={`text-sm mb-2 ${resolvedTheme === 'dark' ? 'text-muted-foreground' : 'text-gray-600'}`}
                >
                  Showing first {MAX_LINES} lines of {content.split('\n').length} total lines
                </p>
                <Button variant="outline" size="sm" onClick={handleToggleContent}>
                  Show All Lines
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
