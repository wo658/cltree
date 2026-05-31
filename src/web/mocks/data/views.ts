import type { IssueViewData, SessionDetailData } from '@shared/types';
import { mockSessions } from './sessions';
import { mockPanes } from './panes';

/** Sample Issue View data */
export const mockIssueData: IssueViewData = {
  number: 42,
  title: 'fix auth middleware',
  state: 'open',
  labels: [
    { name: 'bug', color: 'e11d48' },
    { name: 'auth', color: '7c3aed' },
  ],
  assignees: ['alice'],
  body: 'JWT token verification fails on login.\nRepro: POST /api/login → 401\n\nNeed to check middleware order.',
  comments: [
    {
      author: 'dev1',
      body: 'Might be a middleware ordering issue.',
      createdAt: '2026-03-24T10:30:00Z',
    },
    {
      author: 'alice',
      body: 'Looking into it. Will also check the JWT_SECRET env var.',
      createdAt: '2026-03-24T14:00:00Z',
    },
  ],
};

/** Sample Session Detail data */
export const mockSessionDetailData: SessionDetailData = {
  session: mockSessions[0],
  panes: mockPanes.filter((p) => p.sessionId === 'sess-myapp'),
  children: [
    {
      session: mockSessions[1],
      panes: mockPanes.filter((p) => p.sessionId === 'sess-myapp-42'),
    },
    {
      session: mockSessions[2],
      panes: mockPanes.filter((p) => p.sessionId === 'sess-myapp-15'),
    },
  ],
};
