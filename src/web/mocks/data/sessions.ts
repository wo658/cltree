import type { Session } from '@shared/types';

/** Sample session data */
export const mockSessions: Session[] = [
  {
    id: 'sess-myapp',
    name: 'myapp',
    status: 'active',
    repo: 'alice/myapp',
    cwd: '/home/alice/myapp',
    branch: 'main',
    children: [],
    panes: [],
  },
  {
    id: 'sess-myapp-42',
    name: 'auth-fix',
    status: 'active',
    repo: 'alice/myapp',
    cwd: '/home/alice/.cltree/worktrees/myapp-issue-42',
    parentSessionId: 'sess-myapp',
    issueNumber: 42,
    worktreePath: '/home/alice/.cltree/worktrees/myapp-issue-42',
    branch: 'issue-42-auth-fix',
    children: [],
    panes: [],
  },
  {
    id: 'sess-myapp-15',
    name: 'refactor-api',
    status: 'active',
    repo: 'alice/myapp',
    cwd: '/home/alice/.cltree/worktrees/myapp-issue-15',
    parentSessionId: 'sess-myapp',
    issueNumber: 15,
    worktreePath: '/home/alice/.cltree/worktrees/myapp-issue-15',
    branch: 'issue-15-refactor-api',
    children: [],
    panes: [],
  },
  {
    id: 'sess-free',
    name: 'free-agent-1',
    status: 'active',
    cwd: '/home/alice/workspace',
    children: [],
    panes: [],
  },
];
