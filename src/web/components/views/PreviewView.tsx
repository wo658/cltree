/**
 * Preview View — in-app browser (iframe-based)
 *
 * Provides live preview via a URL bar + iframe.
 * CLI: cltree browse open/navigate/read/screenshot
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { apiClient } from '@web/lib/api-client';
import type { PreviewViewData } from '@shared/types';
import { Globe, ArrowRight, RotateCw, ExternalLink } from 'lucide-react';

/** Convert original URL → reverse proxy URL
 *  Converts to /proxy/<base64(origin)>/path format so that
 *  http-proxy-middleware acts as a real reverse proxy.
 */
function toProxyUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const originB64 = btoa(parsed.origin);
    return `/proxy/${originB64}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

interface PreviewViewProps {
  data: PreviewViewData;
}

export function PreviewView({ data }: PreviewViewProps) {
  const [inputUrl, setInputUrl] = useState(data.url || '');
  const [currentUrl, setCurrentUrl] = useState(data.url || '');
  const [loadError, setLoadError] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  /** Navigate to URL (updates slot data via CLI) */
  const navigate = useCallback((url: string) => {
    if (!url) return;
    // Auto-prepend http://
    const normalizedUrl = url.match(/^https?:\/\//) ? url : `http://${url}`;
    setCurrentUrl(normalizedUrl);
    setInputUrl(normalizedUrl);
    setLoadError(false);
    apiClient.cli(['browse', 'navigate', normalizedUrl]).catch(() => {});
  }, []);

  /** Navigate on Enter key */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      navigate(inputUrl);
    }
  };

  /** Refresh iframe */
  const handleRefresh = () => {
    setLoadError(false);
    if (iframeRef.current) {
      iframeRef.current.src = toProxyUrl(currentUrl);
    }
  };

  /** Open in external browser */
  const handleOpenExternal = () => {
    window.open(currentUrl, '_blank');
  };

  // Reflect external changes to data.url
  useEffect(() => {
    if (data.url && data.url !== currentUrl) {
       
      setCurrentUrl(data.url);
       
      setInputUrl(data.url);
       
      setLoadError(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.url]);

  const effectiveUrl = data.url || currentUrl;
  /** Proxy URL actually loaded in the iframe */
  const iframeSrc = effectiveUrl ? toProxyUrl(effectiveUrl) : '';

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* URL bar */}
      <div className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900/80 px-1.5 py-1">
        {/* Refresh */}
        <button
          onClick={handleRefresh}
          className="rounded p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          title="Refresh"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        {/* URL input */}
        <div className="flex flex-1 items-center gap-1.5 rounded bg-zinc-800/80 border border-zinc-700/50 px-2 py-0.5">
          <Globe className="w-3 h-3 text-zinc-500 flex-shrink-0" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-xs text-zinc-300 outline-none placeholder-zinc-600"
            placeholder="Enter URL…"
            spellCheck={false}
          />
        </div>

        {/* Go button */}
        <button
          onClick={() => navigate(inputUrl)}
          className="rounded p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          title="Go"
        >
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        {/* Open external */}
        <button
          onClick={handleOpenExternal}
          className="rounded p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          title="Open in external browser"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* iframe or error */}
      <div className="flex-1 min-h-0 relative">
        {effectiveUrl ? (
          <>
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              className="w-full h-full border-0"
              style={{ backgroundColor: 'white' }}
              onError={() => setLoadError(true)}
            />
            {loadError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 gap-3">
                <Globe className="w-8 h-8 text-zinc-700" />
                <p className="text-sm">This site cannot be loaded in an iframe</p>
                <p className="text-xs text-zinc-600">Blocked by X-Frame-Options or CSP</p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={handleOpenExternal}
                    className="px-3 py-1 text-xs rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                  >
                    Open in external browser
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
            <Globe className="w-8 h-8 text-zinc-700" />
            <p className="text-sm">Enter a URL</p>
            <p className="text-xs text-zinc-700">or via CLI: cltree browse open &lt;url&gt;</p>
          </div>
        )}
      </div>
    </div>
  );
}
