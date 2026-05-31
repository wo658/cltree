import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minimize2, Download, X } from 'lucide-react';

/** Module-level counter — prevents mermaid render ID collisions */
let nextId = 0;

/** mermaid initialization state */
let mermaidReady: Promise<typeof import('mermaid')['default']> | null = null;

/** mermaid lazy-load + initialization (once only) */
function getMermaid() {
  if (!mermaidReady) {
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#3f3f46',
          primaryTextColor: '#e4e4e7',
          primaryBorderColor: '#52525b',
          lineColor: '#71717a',
          secondaryColor: '#27272a',
          tertiaryColor: '#18181b',
          background: '#18181b',
          mainBkg: '#27272a',
          nodeBorder: '#52525b',
          clusterBkg: '#1e1e22',
          titleColor: '#e4e4e7',
          edgeLabelBackground: '#27272a',
        },
      });
      return m.default;
    });
  }
  return mermaidReady;
}

/**
 * Removes rect background color directives from sequence diagrams.
 * Strips `rect rgb(...)` / `rect rgba(...)` / `rect #hex` lines along with their paired `end`.
 * Prevents custom background colors from clashing with the terminal dark background.
 */
function stripRectBackgrounds(src: string): string {
  const lines = src.split('\n');
  const result: string[] = [];
  let rectDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (/^rect\s+(rgb|rgba|#)/.test(trimmed)) {
      rectDepth++;
      continue;
    }
    if (rectDepth > 0 && trimmed === 'end') {
      rectDepth--;
      continue;
    }
    result.push(line);
  }
  return result.join('\n');
}

/** Convert SVG string to Blob URL */
function svgToDataUrl(svgHtml: string): string {
  const blob = new Blob([svgHtml], { type: 'image/svg+xml;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/** Convert SVG to PNG and download */
function downloadPng(svgHtml: string, filename: string) {
  const svgEl = new DOMParser().parseFromString(svgHtml, 'image/svg+xml').documentElement;
  const w = parseFloat(svgEl.getAttribute('width') || '800');
  const h = parseFloat(svgEl.getAttribute('height') || '600');
  const scale = 2; // High resolution
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const img = new Image();
  const url = svgToDataUrl(svgHtml);
  img.onload = () => {
    ctx.fillStyle = '#18181b';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    a.click();
  };
  img.src = url;
}

/** Download SVG */
function downloadSvg(svgHtml: string, filename: string) {
  const url = svgToDataUrl(svgHtml);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fullscreen overlay */
function FullscreenOverlay({
  svgHtml,
  onClose,
}: {
  svgHtml: string;
  onClose: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9999] bg-zinc-950/95 flex flex-col"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-end gap-1 px-4 py-2 border-b border-zinc-800">
        <button
          onClick={() => downloadSvg(svgHtml, 'mermaid-diagram.svg')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
          title="Download SVG"
        >
          <Download className="w-3.5 h-3.5" />
          SVG
        </button>
        <button
          onClick={() => downloadPng(svgHtml, 'mermaid-diagram.png')}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors"
          title="Download PNG"
        >
          <Download className="w-3.5 h-3.5" />
          PNG
        </button>
        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition-colors ml-2"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* SVG area — overflow auto to allow zoom/pan */}
      <div
        className="flex-1 overflow-auto p-8 [&_svg]:max-w-none [&_svg]:w-auto [&_svg]:h-auto [&_svg]:mx-auto"
        dangerouslySetInnerHTML={{ __html: svgHtml }}
      />
    </div>,
    document.body,
  );
}

interface MermaidDiagramProps {
  source: string;
}

/** Mermaid diagram SVG renderer */
export function MermaidDiagram({ source }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svgHtml, setSvgHtml] = useState<string>('');
  const [fullscreen, setFullscreen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const idRef = useRef(`mermaid-${nextId++}`);

  const handleClose = useCallback(() => setFullscreen(false), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mermaid = await getMermaid();
        const cleaned = stripRectBackgrounds(source);
        const { svg } = await mermaid.render(idRef.current, cleaned);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setSvgHtml(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => { cancelled = true; };
  }, [source]);

  if (error) {
    return (
      <div className="flex flex-col gap-2 p-4 h-full overflow-auto bg-zinc-900">
        <span className="text-xs text-red-400">Mermaid render failed</span>
        <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap break-all rounded-md bg-zinc-950 border border-zinc-800 p-3">
          {source}
        </pre>
      </div>
    );
  }

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Action buttons on hover */}
      {hovered && svgHtml && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <button
            onClick={() => downloadSvg(svgHtml, 'mermaid-diagram.svg')}
            className="p-1.5 bg-zinc-800/90 text-zinc-400 hover:text-zinc-100 rounded backdrop-blur-sm transition-colors"
            title="Download SVG"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setFullscreen(true)}
            className="p-1.5 bg-zinc-800/90 text-zinc-400 hover:text-zinc-100 rounded backdrop-blur-sm transition-colors"
            title="Fullscreen"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="p-4 overflow-auto w-full bg-zinc-900 max-h-[60vh] [&_svg]:max-w-full [&_svg]:w-auto [&_svg]:h-auto [&_svg]:mx-auto cursor-pointer"
        onDoubleClick={() => svgHtml && setFullscreen(true)}
      />

      {/* Fullscreen overlay */}
      {fullscreen && svgHtml && (
        <FullscreenOverlay svgHtml={svgHtml} onClose={handleClose} />
      )}
    </div>
  );
}
