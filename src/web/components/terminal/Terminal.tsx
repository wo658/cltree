import { memo } from 'react';
import { useTerminal } from '@web/hooks/useTerminal';
import type { PaneType } from '@shared/types';

interface TerminalProps {
  paneId: string;
  paneType?: PaneType;
}

/**
 * xterm.js terminal component.
 * Manages the instance via the useTerminal hook; subscribes/unsubscribes PTY streams.
 * Memoized to remount only when paneId changes — prevents dispose caused by parent re-renders.
 */
export const Terminal = memo(function Terminal({ paneId, paneType }: TerminalProps) {
  const { attachToContainer } = useTerminal(paneId, paneType);

  return (
    <div
      ref={attachToContainer}
      className="h-full w-full bg-[#09090b]"
    />
  );
});
