import { openUrl } from '@session/browser-opener';
import { ArrowLeft, ArrowRight, ExternalLink, Globe, RefreshCw } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { Button } from '@session/components/ui/button';
import { Input } from '@session/components/ui/input';
import { useWebviewStore } from '@session/stores/useWebViewStore';

interface WebPreviewProps {
  url?: string;
  onUrlChange?: (url: string) => void;
}

export const WebPreview: React.FC<WebPreviewProps> = ({ url = '', onUrlChange }) => {
  const { history, index, addUrl, goBack, goForward } = useWebviewStore();
  const currentUrl = history[index] ?? '';
  const [inputUrl, setInputUrl] = useState(currentUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [frameUrl, setFrameUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!currentUrl) { setFrameUrl(''); return; }
    const controller = new AbortController();
    async function resolve() {
      try {
        const target = new URL(currentUrl);
        if (!['http:', 'https:'].includes(target.protocol)) throw new Error('无效的预览地址');
        if (target.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(target.hostname)) {
          const response = await fetch('/api/session-previews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: currentUrl }), signal: controller.signal });
          const result = await response.json(); if (!response.ok) throw new Error(result.error);
          if (!controller.signal.aborted) setFrameUrl(result.path);
        } else { setFrameUrl(currentUrl); }
      } catch (error) { if (!controller.signal.aborted) { setError(error instanceof Error ? error.message : '无法打开预览'); setFrameUrl(''); } }
    }
    void resolve(); return () => controller.abort();
  }, [currentUrl]);
  // Sync inputUrl with store's currentUrl when it changes
  useEffect(() => {
    setInputUrl(currentUrl);
  }, [currentUrl]);

  // Add prop url to store when it changes
  useEffect(() => {
    if (url) {
      addUrl(url);
    }
  }, [url, addUrl]);

  // Notify parent of URL changes via onUrlChange
  useEffect(() => {
    if (currentUrl) {
      onUrlChange?.(currentUrl);
    }
  }, [currentUrl, onUrlChange]);

  const handleRefresh = () => {
    setIsLoading(true);
    // Force iframe reload by changing key
    const iframe = document.querySelector('#web-preview-iframe') as HTMLIFrameElement;
    if (iframe) {
      // Re-assigning through a temporary forces the iframe to reload.
      const { src } = iframe;
      iframe.src = 'about:blank';
      iframe.src = src;
    }
    setTimeout(() => setIsLoading(false), 1000);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Add the input URL to history (store will handle duplicates and history management)
    try {
      const target = new URL(inputUrl.trim());
      if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('请输入 HTTP 或 HTTPS 网址');
      setError(''); addUrl(target.href);
    } catch { setError('请输入有效的 HTTP 或 HTTPS 网址'); }
    // Clear the input after submitting? Or keep it? We'll keep it as the current URL.
    // The effect above will sync the input with the store's currentUrl after addUrl.
  };

  const handleOpenExternal = async () => {
    if (currentUrl) await openUrl(currentUrl);
  };

  return (
    <div className="h-full flex flex-col bg-background border-l">
      {/* Header */}
      <div className="flex items-center gap-2 p-2 border-b bg-muted/30">
        <Button
          onClick={goBack}
          disabled={index <= 0}
          size="icon"
          variant="ghost"
          className="h-7 w-7 p-0"
        >
          <ArrowLeft className="w-3 h-3" />
        </Button>
        <Button
          onClick={goForward}
          disabled={index >= history.length - 1}
          size="icon"
          variant="ghost"
          className="h-7 w-7 p-0"
        >
          <ArrowRight className="w-3 h-3" />
        </Button>
        <Button
          onClick={handleRefresh}
          size="icon"
          variant="ghost"
          disabled={isLoading}
          className="h-7 w-7 p-0"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
        </Button>

        <form onSubmit={handleUrlSubmit} className="flex-1 flex gap-1">
          <Input
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="输入网址…"
            className="text-xs h-7"
          />
        </form>
        <Button onClick={handleOpenExternal} size="sm" variant="ghost" className="h-7 w-7 p-0">
          <ExternalLink className="w-3 h-3" />
        </Button>
      </div>

      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
      {/* Preview Content */}
      <div className="flex-1 relative overflow-hidden">
        {frameUrl ? (
          <iframe
            id="web-preview-iframe"
            src={frameUrl}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            title="网页预览"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {history.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {history.map((historyUrl: string, idx: number) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: history can hold the same URL twice (A -> B -> A)
                  <li key={idx}>
                    <Button
                      onClick={() => addUrl(historyUrl)}
                      variant="outline"
                      className="text-xs truncate max-w-md"
                    >
                      {historyUrl}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center">
                <Globe className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">输入网址开始预览</p>
                <p className="text-xs mt-1">支持网页和当前项目的开发服务</p>
              </div>
            )}
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
            <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
};
