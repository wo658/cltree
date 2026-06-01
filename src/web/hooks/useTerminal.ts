import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { wsClient } from '@web/lib/ws-client';
import { useAppStore } from '@web/stores';
import type { WsServerMessage, PaneType } from '@shared/types';

/** Default font fallback chain */
const DEFAULT_FONT = '"JetBrains Mono", "Fira Code", "Cascadia Code", "SF Mono", Menlo, Monaco, "Courier New", monospace';

/** Call fit() only when a size change is needed */
function safeFit(
  fitAddon: FitAddon,
  terminal: Terminal,
  _el: HTMLElement,
): boolean {
  const dims = fitAddon.proposeDimensions();
  if (!dims) return false;
  if (dims.cols === terminal.cols && dims.rows === terminal.rows) return false;
  fitAddon.fit();
  return true;
}

/** Hook to manage the xterm.js terminal instance */
export function useTerminal(paneId: string, _paneType: PaneType = 'terminal') {
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fittingRef = useRef(false);

  /** Mount terminal into the container */
  const attachToContainer = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el;

      if (!el) return;
      if (terminalRef.current) return;

      console.log(`[useTerminal] mount paneId=${paneId}`);

      const cfg = useAppStore.getState().xtermConfig;

      const terminal = new Terminal({
        fontSize: cfg.fontSize ?? 13,
        fontFamily: cfg.fontFamily || DEFAULT_FONT,
        cursorBlink: cfg.cursorBlink ?? true,
        cursorStyle: cfg.cursorStyle ?? 'block',
        scrollback: 5000,
        theme: {
          background: '#09090b',
          foreground: '#fafafa',
          cursor: '#a1a1aa',
          selectionBackground: '#3f3f46',
          black: '#09090b',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#fafafa',
          brightBlack: '#52525b',
          brightRed: '#f87171',
          brightGreen: '#4ade80',
          brightYellow: '#facc15',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#ffffff',
        },
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(el);
      fitAddon.fit();

      // WebGL accelerated rendering (when supported).
      // The demo recorder sets window.__CLTREE_NO_WEBGL__ so xterm falls back to the
      // DOM renderer — puppeteer screenshots cannot capture the WebGL canvas (it shows
      // up black), so the recording would otherwise have empty terminal panes.
      if (!(window as unknown as { __CLTREE_NO_WEBGL__?: boolean }).__CLTREE_NO_WEBGL__) {
        try {
          const webglAddon = new WebglAddon();
          webglAddon.onContextLoss(() => {
            console.warn(`[useTerminal] WebGL context loss paneId=${paneId}`);
            webglAddon.dispose();
          });
          terminal.loadAddon(webglAddon);
        } catch {
          // Fallback to canvas when WebGL is not supported
        }
      }

      // 🔍 Track buffer changes (alternate screen, etc.)
      terminal.buffer.onBufferChange((buf) => {
        console.log(`[useTerminal] buffer changed paneId=${paneId} type=${buf.type}`);
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // Terminal mounted → request ring buffer replay
      wsClient.send({ type: 'pty-replay', paneId });

      // Terminal input → PTY
      terminal.onData((data) => {
        wsClient.send({ type: 'pty-input', paneId, data });
      });

      // Size change → PTY
      terminal.onResize(({ cols, rows }) => {
        console.log(`[useTerminal] resize paneId=${paneId} cols=${cols} rows=${rows}`);
        wsClient.send({ type: 'pty-resize', paneId, cols, rows });
      });
    },
    [paneId],
  );

  // PTY output → terminal
  useEffect(() => {
    const unsubscribe = wsClient.onMessage((msg: WsServerMessage) => {
      if (msg.type === 'pty-output' && msg.paneId === paneId) {
        terminalRef.current?.write(msg.data);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [paneId]);

  // ResizeObserver → safeFit
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      if (fittingRef.current) return;
      const fitAddon = fitAddonRef.current;
      const term = terminalRef.current;
      if (!fitAddon || !term) return;

      fittingRef.current = true;
      const changed = safeFit(fitAddon, term, el);
      if (changed) {
        console.log(`[useTerminal] ResizeObserver fit paneId=${paneId} ${term.cols}x${term.rows}`);
      }
      requestAnimationFrame(() => {
        fittingRef.current = false;
      });
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, [paneId]);

  // Cleanup
  useEffect(() => {
    return () => {
      console.log(`[useTerminal] dispose paneId=${paneId}`);
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [paneId]);

  // Recreate after a cleanup that left the container mounted. React StrictMode (dev)
  // runs effect cleanup then re-runs setup WITHOUT re-invoking the callback ref, so the
  // terminal disposed above is otherwise never recreated and the pane renders blank.
  // This effect re-runs on the StrictMode remount and rebuilds the disposed instance.
  useEffect(() => {
    if (containerRef.current && !terminalRef.current) {
      attachToContainer(containerRef.current);
    }
  }, [paneId, attachToContainer]);

  return { attachToContainer };
}
