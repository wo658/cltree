import type { PaneRef } from '@shared/types';

/** Sample pane data */
export const mockPanes: PaneRef[] = [
  {
    id: 'pane-myapp-agent',
    type: 'agent',
    cmd: 'claude --permission-mode auto',
    status: 'busy',
    sessionId: 'sess-myapp',
  },
  {
    id: 'pane-myapp-dev',
    type: 'terminal',
    cmd: 'pnpm run dev',
    status: 'running',
    sessionId: 'sess-myapp',
  },
  {
    id: 'pane-42-agent',
    type: 'agent',
    cmd: 'claude --permission-mode auto',
    status: 'idle',
    sessionId: 'sess-myapp-42',
  },
  {
    id: 'pane-15-agent',
    type: 'agent',
    cmd: 'claude',
    status: 'done',
    sessionId: 'sess-myapp-15',
  },
  {
    id: 'pane-free-agent',
    type: 'agent',
    cmd: 'claude',
    status: 'idle',
    sessionId: 'sess-free',
  },
];
