import { ArrowUp, ChevronDown, FolderOpen, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@session/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@session/components/ui/dropdown-menu';
import { Input } from '@session/components/ui/input';
import {
  canonicalizePath,
  getHomeDirectory,
  readDirectory,
  type TauriFileEntry,
} from '@session/services/apiAdapt';

function getParentPath(path: string): string | null {
  const normalized = path.replace(/[\\/]+$/, '');
  if (!normalized) return null;
  const parts = normalized.split(/[\\/]+/);
  if (parts.length <= 1) return null;
  if (normalized.startsWith('/')) {
    return `/${parts.slice(1, -1).join('/')}` || '/';
  }
  return parts.slice(0, -1).join('\\') || null;
}

function splitPathSegments(path: string): { name: string; path: string }[] {
  if (!path) return [];
  const normalized = path.replace(/[\\/]+$/, '');
  const separator = normalized.includes('\\') && !normalized.includes('/') ? '\\' : '/';
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.map((part, i) => ({
    name: part,
    path:
      i === 0 && normalized.startsWith('/') ? `/${part}` : parts.slice(0, i + 1).join(separator),
  }));
}

interface BrowserProjectsProps {
  onAddProject: (path: string) => void;
  cwd: string | null;
  search?: string;
  onSearchChange?: (value: string) => void;
}

export function BrowserProjects({
  onAddProject,
  cwd,
  search: searchProp = '',
  onSearchChange,
}: BrowserProjectsProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [sharedProjects, setSharedProjects] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    fetch("/api/workbench/projects").then(response => response.ok ? response.json() : { projects: [] }).then(result => { if (active && Array.isArray(result.projects)) setSharedProjects(result.projects); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [pathInput, setPathInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [_, setHomeDir] = useState('');
  const [entries, setEntries] = useState<TauriFileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [internalSearch, setInternalSearch] = useState('');

  const search = onSearchChange ? searchProp : internalSearch;
  const setSearch = onSearchChange ?? setInternalSearch;

  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const requestVersion = useRef(0);
  const inputVersion = useRef(0);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  const loadDirectory = useCallback(
    async (path: string) => {
      if (!path) return;
      setIsLoading(true);
      setError(null);

      const currentVersion = ++requestVersion.current;
      const inputAtRequest = inputVersion.current;

      try {
        const canonicalPath = await canonicalizePath(path);
        const data = await readDirectory(canonicalPath);

        if (currentVersion === requestVersion.current) {
          setCurrentPath(canonicalPath);
          if (inputVersion.current === inputAtRequest) setPathInput(canonicalPath);
          setEntries(data);
          setSearch('');
          setFocusedIndex(-1);
        }
      } catch (error) {
        if (currentVersion === requestVersion.current) setError(error instanceof Error ? error.message : "无法读取目录");
      } finally {
        if (currentVersion === requestVersion.current) {
          setIsLoading(false);
        }
      }
    },
    [setSearch]
  );

  useEffect(() => {
    let isMounted = true;
    const version = requestVersion.current;
    void (async () => {
      const home = await getHomeDirectory().catch(() => '');
      if (!isMounted || requestVersion.current !== version) return;
      setHomeDir(home);
      const startPath = cwd || home;
      if (startPath) {
        await loadDirectory(startPath);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [cwd, loadDirectory]);

  const parentPath = useMemo(() => getParentPath(currentPath), [currentPath]);
  const pathSegments = useMemo(() => splitPathSegments(currentPath), [currentPath]);

  const reversedSegments = useMemo(() => {
    return [...pathSegments].reverse();
  }, [pathSegments]);

  const currentDirName = useMemo(() => {
    if (pathSegments.length === 0) return 'Root';
    return pathSegments[pathSegments.length - 1].name;
  }, [pathSegments]);

  const directoryEntries = useMemo(
    () =>
      entries.filter(
        (entry) => entry.is_dir && entry.name.toLowerCase().includes(search.toLowerCase())
      ),
    [entries, search]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).getAttribute("aria-label") === "服务器目录路径") return;
    const isInputActive = (e.target as HTMLElement).tagName === 'INPUT';
    const hasParentRow = parentPath && !search;
    const totalRows = directoryEntries.length + (hasParentRow ? 1 : 0);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex((prev) => (prev < totalRows - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (focusedIndex === 0 && isInputActive) return;
      if (focusedIndex === 0 && !isInputActive) {
        setFocusedIndex(-1);
      } else {
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : prev));
      }
    } else if (e.key === 'Enter') {
      if (focusedIndex === -1 && isInputActive) {
        if (directoryEntries.length === 1) {
          e.preventDefault();
          void loadDirectory(directoryEntries[0].path);
        }
        return;
      }

      e.preventDefault();
      if (hasParentRow && focusedIndex === 0) {
        void loadDirectory(parentPath);
      } else {
        const entryIndex = hasParentRow ? focusedIndex - 1 : focusedIndex;
        const targetEntry = directoryEntries[entryIndex];
        if (targetEntry) {
          void loadDirectory(targetEntry.path);
        }
      }
    }
  };

  useEffect(() => {
    if (focusedIndex >= 0 && listContainerRef.current) {
      const rows = listContainerRef.current.querySelectorAll('[role="button"]');
      (rows[focusedIndex] as HTMLElement)?.focus();
    }
  }, [focusedIndex]);

  const hasParentRow = parentPath && !search;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: container-level key handling for list navigation; focus lives on the child controls
    <div className="flex flex-col outline-none" onKeyDown={handleKeyDown}>
      {sharedProjects.length > 0 && <select aria-label="共享项目" className="rounded border bg-background text-sm p-2 m-2" value="" onChange={event => { inputVersion.current++; setPathInput(event.target.value); void loadDirectory(event.target.value); }}><option value="">选择工作台已有项目…</option>{sharedProjects.map(path => <option key={path} value={path}>{path}</option>)}</select>}
      <form className="flex gap-2 border-b p-2" onSubmit={event => { event.preventDefault(); void loadDirectory(pathInput.trim()); }}>
        <Input aria-label="服务器目录路径" placeholder="输入服务器目录的绝对路径" value={pathInput} onChange={event => { inputVersion.current++; setPathInput(event.target.value); }} />
        <Button type="submit" variant="outline" disabled={isLoading || !pathInput.trim()}>前往</Button>
      </form>
      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-1 border-b px-2 py-1.5 bg-muted/10 justify-center">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 flex items-center justify-center gap-1 text-sm font-medium max-w-[200px] truncate m-auto"
            >
              <span className="truncate">{currentDirName}</span>
              <ChevronDown className="h-3 w-3 opacity-60 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[160px] max-w-[260px] max-h-[300px] overflow-y-auto"
          >
            {reversedSegments.map((seg) => (
              <DropdownMenuItem
                key={seg.path}
                onClick={() => void loadDirectory(seg.path)}
                className="text-xs truncate cursor-pointer py-1.5"
                title={seg.path}
              >
                {seg.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Input
        autoFocus
        placeholder="筛选文件夹…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-8 text-sm"
      />

      <div
        ref={listContainerRef}
        className="min-h-[240px] max-h-[360px] overflow-y-auto flex flex-col"
      >
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading folders...</span>
          </div>
        ) : (
          <div className="p-1 flex-1">
            {hasParentRow && (
              <div
                role="button"
                tabIndex={focusedIndex === 0 ? 0 : -1}
                onClick={() => void loadDirectory(parentPath)}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground select-none outline-none ${focusedIndex === 0 ? 'bg-accent text-accent-foreground font-medium' : ''}`}
              >
                <ArrowUp />
              </div>
            )}

            {directoryEntries.map((entry, index) => {
              const globalIndex = hasParentRow ? index + 1 : index;
              const isFocused = focusedIndex === globalIndex;
              return (
                <div
                  key={entry.path}
                  role="button"
                  tabIndex={isFocused ? 0 : -1}
                  onClick={() => void loadDirectory(entry.path)}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    onAddProject(entry.path);
                  }}
                  className={`group flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none ${isFocused ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}`}
                >
                  <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                  <span className="flex-1 truncate">{entry.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      void onAddProject(entry.path);
                    }}
                  >
                    选择
                  </Button>
                </div>
              );
            })}

            {directoryEntries.length === 0 && !hasParentRow && (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
                没有找到文件夹
              </div>
            )}
          </div>
        )}
      </div>

      {currentPath && (
        <div className="border-t px-2 py-2 bg-muted/10">
          <Button
            variant="secondary"
            size="sm"
            className="w-full gap-2 shadow-sm border"
            disabled={isLoading}
            onClick={() => onAddProject(currentPath)}
          >
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-xs">选择当前目录</span>
          </Button>
        </div>
      )}
    </div>
  );
}
