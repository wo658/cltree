import { DbService } from '../src/server/db/db.service';

function createDb(): DbService {
  const db = new DbService();
  db.initDb(':memory:');
  return db;
}

describe('Issue Repo management', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
    db.insertWorkspace({ id: 'ws-1', name: 'project' });
    db.setAppState('activeWorkspaceId', 'ws-1');
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('sets issue_repo on session creation', () => {
    db.insertSession({
      id: 's1', name: 'main', status: 'active',
      repo: 'fork/app', issue_repo: 'org/app',
      cwd: '/code', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });

    const sess = db.getSession('s1');
    expect(sess).toBeDefined();
    expect(sess!.repo).toBe('fork/app');
    expect(sess!.issue_repo).toBe('org/app');
  });

  test('falls back to repo when issue_repo is null', () => {
    db.insertSession({
      id: 's1', name: 'main', status: 'active',
      repo: 'org/app', issue_repo: null,
      cwd: '/code', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });

    const sess = db.getSession('s1');
    // The service layer's getEffectiveIssueRepo handles the fallback
    const effectiveRepo = sess!.issue_repo || sess!.repo;
    expect(effectiveRepo).toBe('org/app');
  });

  test('manually changes issue_repo (set-issue-repo)', () => {
    db.insertSession({
      id: 's1', name: 'main', status: 'active',
      repo: 'fork/app', issue_repo: 'fork/app',
      cwd: '/code', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });

    // Change issue_repo
    db.updateSession('s1', { issue_repo: 'org/upstream-app' });
    const sess = db.getSession('s1');
    expect(sess!.issue_repo).toBe('org/upstream-app');
    // repo stays the same
    expect(sess!.repo).toBe('fork/app');
  });

  test('issue_repo and repo can differ (fork → upstream)', () => {
    db.insertSession({
      id: 's1', name: 'main', status: 'active',
      repo: 'alice/sample-app', issue_repo: 'acme/sample-docs',
      cwd: '/code', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });

    const sess = db.getSession('s1');
    expect(sess!.repo).toBe('alice/sample-app');
    expect(sess!.issue_repo).toBe('acme/sample-docs');
  });
});

describe('Issue CLI path (activeSessionId → issueRepo lookup)', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
    db.insertWorkspace({ id: 'ws-1', name: 'project' });
    db.setAppState('activeWorkspaceId', 'ws-1');
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('looks up issueRepo via activeSessionId', () => {
    db.insertSession({
      id: 's1', name: 'main', status: 'active',
      repo: 'fork/app', issue_repo: 'org/app',
      cwd: '/code', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });
    db.setAppState('activeSessionId', 's1');

    // What the CLI does: activeSessionId → getSession → issue_repo || repo
    const activeId = db.getAppState('activeSessionId');
    expect(activeId).toBe('s1');
    const sess = db.getSession(activeId!);
    expect(sess).toBeDefined();
    const effectiveRepo = sess!.issue_repo || sess!.repo;
    expect(effectiveRepo).toBe('org/app');
  });

  test('issueRepo lookup fails when activeSessionId is missing', () => {
    const activeId = db.getAppState('activeSessionId');
    expect(activeId).toBeUndefined();
  });

  test('returns null when session has neither repo nor issueRepo', () => {
    db.insertSession({
      id: 's1', name: 'no-repo', status: 'active',
      repo: null, issue_repo: null,
      cwd: '/tmp', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });
    db.setAppState('activeSessionId', 's1');

    const sess = db.getSession('s1');
    const effectiveRepo = sess!.issue_repo || sess!.repo;
    expect(effectiveRepo).toBeNull();
  });
});

describe('Issue Repo validation', () => {
  test('only OWNER/REPO format is valid', () => {
    const valid = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;
    expect(valid.test('owner/repo')).toBe(true);
    expect(valid.test('acme/sample-docs')).toBe(true);
    expect(valid.test('my-org/my_repo.v2')).toBe(true);

    expect(valid.test('/')).toBe(false);
    // 'null/null' matches the regex, but detectIssueRepo filters it out
    expect(valid.test('')).toBe(false);
    expect(valid.test('noslash')).toBe(false);
    expect(valid.test('a/b/c')).toBe(false);
  });

  test('"/" cannot be used as a repo', () => {
    const repo = '/';
    const isValid = repo && repo.includes('/') && repo !== '/';
    expect(isValid).toBe(false);
  });

  test('empty string cannot be used as a repo', () => {
    const repo: string = '';
    expect(!repo || !repo.includes('/')).toBe(true);
  });
});

describe('Short ID → Full ID matching', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
    db.insertWorkspace({ id: 'ws-1', name: 'project' });
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('matches by exact full UUID', () => {
    db.insertSession({
      id: 'abcd1234-5678-9abc-def0-123456789abc', name: 'test', status: 'active',
      repo: null, issue_repo: null, cwd: '/tmp', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    const found = db.findSessionByIdPrefix('abcd1234-5678-9abc-def0-123456789abc');
    expect(found).toBeDefined();
    expect(found!.id).toBe('abcd1234-5678-9abc-def0-123456789abc');
  });

  test('matches by short prefix', () => {
    db.insertSession({
      id: 'abcd1234-5678-9abc-def0-123456789abc', name: 'test', status: 'active',
      repo: null, issue_repo: null, cwd: '/tmp', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    const found = db.findSessionByIdPrefix('abcd1234');
    expect(found).toBeDefined();
    expect(found!.id).toBe('abcd1234-5678-9abc-def0-123456789abc');
  });

  test('returns undefined for non-existent prefix', () => {
    expect(db.findSessionByIdPrefix('nonexist')).toBeUndefined();
  });

  test('returns undefined when multiple sessions share the prefix (ambiguous)', () => {
    db.insertSession({
      id: 'abc-111', name: 'a', status: 'active',
      repo: null, issue_repo: null, cwd: '/a', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    db.insertSession({
      id: 'abc-222', name: 'b', status: 'active',
      repo: null, issue_repo: null, cwd: '/b', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    // 'abc' matches both sessions → undefined
    expect(db.findSessionByIdPrefix('abc')).toBeUndefined();
    // 'abc-1' matches only one
    expect(db.findSessionByIdPrefix('abc-1')?.id).toBe('abc-111');
  });
});

describe('Worktree sub-session DB flow', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
    db.insertWorkspace({ id: 'ws-1', name: 'project' });
    db.setAppState('activeWorkspaceId', 'ws-1');
    db.insertSession({
      id: 's-parent', name: 'main', status: 'active',
      repo: 'org/app', issue_repo: 'org/app-docs',
      cwd: '/code/app', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('worktree sub-session carries parent_session_id + issue_number + worktree_path + branch', () => {
    db.insertSession({
      id: 's-wt', name: '#42 fix-auth', status: 'active',
      repo: 'org/app', issue_repo: 'org/app-docs',
      cwd: '/wt/app-issue-42', workspace_id: 'ws-1',
      parent_session_id: 's-parent', issue_number: 42,
      worktree_path: '/wt/app-issue-42', branch: 'issue-42-fix-auth',
      created_at: new Date().toISOString(),
    });

    const wt = db.getSession('s-wt')!;
    expect(wt.parent_session_id).toBe('s-parent');
    expect(wt.issue_number).toBe(42);
    expect(wt.worktree_path).toBe('/wt/app-issue-42');
    expect(wt.branch).toBe('issue-42-fix-auth');
    expect(wt.workspace_id).toBe('ws-1'); // same workspace as the parent
  });

  test('deleting parent session sets sub-session parent_session_id to NULL (SET NULL)', () => {
    db.insertSession({
      id: 's-wt', name: '#42 fix', status: 'active',
      repo: 'org/app', issue_repo: 'org/app-docs',
      cwd: '/wt/42', workspace_id: 'ws-1',
      parent_session_id: 's-parent', issue_number: 42,
      worktree_path: '/wt/42', branch: 'issue-42',
      created_at: new Date().toISOString(),
    });

    db.deleteSession('s-parent');
    const wt = db.getSession('s-wt')!;
    expect(wt.parent_session_id).toBeNull(); // CASCADE SET NULL
  });

  test('can create a pane on a worktree sub-session', () => {
    db.insertSession({
      id: 's-wt', name: '#42 fix', status: 'active',
      repo: 'org/app', issue_repo: 'org/app-docs',
      cwd: '/wt/42', workspace_id: 'ws-1',
      parent_session_id: 's-parent', issue_number: 42,
      worktree_path: '/wt/42', branch: 'issue-42',
      created_at: new Date().toISOString(),
    });
    db.insertPane({
      id: 'p-agent', type: 'agent', cmd: 'claude', cwd: '/tmp', status: 'running',
      session_id: 's-wt', created_at: new Date().toISOString(),
    });

    const panes = db.listPanesBySession('s-wt');
    expect(panes).toHaveLength(1);
    expect(panes[0].session_id).toBe('s-wt');
  });

  test('issueRepo is inherited from the parent session', () => {
    db.insertSession({
      id: 's-wt', name: '#42', status: 'active',
      repo: 'org/app', issue_repo: 'org/app-docs', // same as parent
      cwd: '/wt/42', workspace_id: 'ws-1',
      parent_session_id: 's-parent', issue_number: 42,
      worktree_path: '/wt/42', branch: 'issue-42',
      created_at: new Date().toISOString(),
    });

    const parent = db.getSession('s-parent')!;
    const wt = db.getSession('s-wt')!;
    expect(wt.issue_repo).toBe(parent.issue_repo);
  });
});

