import { DbService } from '../src/server/db/db.service';

/**
 * Tests SessionService logic by calling DbService directly.
 * Validates the DB layer without NestJS DI.
 */

function createDb(): DbService {
  const db = new DbService();
  db.initDb(':memory:');
  return db;
}

describe('Workspace → Session full flow', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('create workspace → create session → list sessions', () => {
    // 1. Create workspace
    db.insertWorkspace({ id: 'ws-1', name: 'my-project' });
    db.setAppState('activeWorkspaceId', 'ws-1');

    // 2. Create sessions that belong to the workspace
    db.insertSession({
      id: 's1', name: 'backend', status: 'active',
      repo: 'org/backend', issue_repo: 'org/backend',
      cwd: '/code/backend', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });
    db.insertSession({
      id: 's2', name: 'frontend', status: 'active',
      repo: 'org/frontend', issue_repo: null,
      cwd: '/code/frontend', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });

    // 3. List sessions by workspace
    const sessions = db.listSessionsByWorkspace('ws-1');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].name).toBe('backend');
    expect(sessions[1].name).toBe('frontend');
  });

  test('switching workspaces shows different session lists', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    db.insertWorkspace({ id: 'ws-2', name: 'project-b' });

    db.insertSession({
      id: 's1', name: 'api', status: 'active', repo: null,
      issue_repo: null, cwd: '/a', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });
    db.insertSession({
      id: 's2', name: 'blog', status: 'active', repo: null,
      issue_repo: null, cwd: '/b', workspace_id: 'ws-2',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });

    // ws-1 active
    db.setAppState('activeWorkspaceId', 'ws-1');
    expect(db.listSessionsByWorkspace(db.getAppState('activeWorkspaceId')!)).toHaveLength(1);
    expect(db.listSessionsByWorkspace(db.getAppState('activeWorkspaceId')!)[0].name).toBe('api');

    // switch to ws-2
    db.setAppState('activeWorkspaceId', 'ws-2');
    expect(db.listSessionsByWorkspace(db.getAppState('activeWorkspaceId')!)).toHaveLength(1);
    expect(db.listSessionsByWorkspace(db.getAppState('activeWorkspaceId')!)[0].name).toBe('blog');
  });

  test('add pane to session → deleting workspace cascades everything', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'temp' });
    db.insertSession({
      id: 's1', name: 'sess', status: 'active', repo: null,
      issue_repo: null, cwd: '/tmp', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });
    db.insertPane({
      id: 'p1', type: 'agent', cmd: 'claude', cwd: '/tmp', status: 'running',
      session_id: 's1', created_at: new Date().toISOString(),
    });
    // Everything exists
    expect(db.getSession('s1')).toBeDefined();
    expect(db.getPane('p1')).toBeDefined();

    // Delete workspace
    db.deleteWorkspace('ws-1');

    // Everything cascades away
    expect(db.getSession('s1')).toBeUndefined();
    expect(db.getPane('p1')).toBeUndefined();
  });

  test('allows session creation without activeWorkspaceId (workspace_id = null)', () => {
    // The session is inserted into the DB even without a workspace
    // (the service layer is responsible for raising errors separately).
    db.insertSession({
      id: 's1', name: 'orphan', status: 'active', repo: null,
      issue_repo: null, cwd: '/tmp', workspace_id: null,
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });
    expect(db.getSession('s1')).toBeDefined();
    expect(db.getSession('s1')!.workspace_id).toBeNull();
  });

  test('renames a workspace', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'old' });
    db.updateWorkspace('ws-1', { name: 'new-name' });
    expect(db.getWorkspace('ws-1')!.name).toBe('new-name');
  });

  test('activeWorkspaceId after workspace deletion', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'a' });
    db.insertWorkspace({ id: 'ws-2', name: 'b' });
    db.setAppState('activeWorkspaceId', 'ws-1');

    db.deleteWorkspace('ws-1');

    // activeWorkspaceId remains 'ws-1' in app_state (the DB layer does not
    // clean it up automatically — the service layer's deleteWorkspace should).
    expect(db.getAppState('activeWorkspaceId')).toBe('ws-1');
    // The workspace itself is gone, though.
    expect(db.getWorkspace('ws-1')).toBeUndefined();
  });

  test('set workspace ghProfile and read it from a session', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'vox-project' });
    db.updateWorkspace('ws-1', { gh_profile: 'octo-user' });
    db.setAppState('activeWorkspaceId', 'ws-1');

    db.insertSession({
      id: 's1', name: 'main', status: 'active',
      repo: 'acme/app', issue_repo: null,
      cwd: '/code', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });

    // session → workspace → gh_profile
    const sess = db.getSession('s1')!;
    const ws = db.getWorkspace(sess.workspace_id!)!;
    expect(ws.gh_profile).toBe('octo-user');
  });

  test('session whose workspace has no ghProfile', () => {
    db.insertWorkspace({ id: 'ws-2', name: 'personal' });
    db.setAppState('activeWorkspaceId', 'ws-2');

    db.insertSession({
      id: 's2', name: 'side', status: 'active',
      repo: 'wo658/blog', issue_repo: null,
      cwd: '/code', workspace_id: 'ws-2',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });

    const sess = db.getSession('s2')!;
    const ws = db.getWorkspace(sess.workspace_id!)!;
    expect(ws.gh_profile).toBeNull();
  });

  test('sub-session (worktree) belongs to the same workspace as its parent', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project' });
    db.insertSession({
      id: 's-parent', name: 'main', status: 'active', repo: 'org/app',
      issue_repo: 'org/app', cwd: '/code', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null,
      created_at: new Date().toISOString(),
    });
    db.insertSession({
      id: 's-child', name: 'issue-42', status: 'active', repo: 'org/app',
      issue_repo: 'org/app', cwd: '/wt/issue-42', workspace_id: 'ws-1',
      parent_session_id: 's-parent', issue_number: 42,
      worktree_path: '/wt/issue-42', branch: 'issue-42-fix',
      created_at: new Date().toISOString(),
    });

    const sessions = db.listSessionsByWorkspace('ws-1');
    expect(sessions).toHaveLength(2);

    const child = sessions.find(s => s.id === 's-child');
    expect(child).toBeDefined();
    expect(child!.parent_session_id).toBe('s-parent');
    expect(child!.issue_number).toBe(42);
    expect(child!.worktree_path).toBe('/wt/issue-42');
  });
});
