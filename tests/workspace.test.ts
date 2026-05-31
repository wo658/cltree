import { DbService } from '../src/server/db/db.service';

/** Helper that creates an in-memory DbService */
function createDb(): DbService {
  const db = new DbService();
  db.initDb(':memory:');
  return db;
}

describe('Workspace CRUD', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('initial state: no workspaces', () => {
    const list = db.listWorkspaces();
    expect(list).toHaveLength(0);
  });

  test('creates a workspace', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a', description: 'test' });
    const list = db.listWorkspaces();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('project-a');
    expect(list[0].description).toBe('test');
  });

  test('looks up a workspace', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    const ws = db.getWorkspace('ws-1');
    expect(ws).toBeDefined();
    expect(ws!.id).toBe('ws-1');
    expect(ws!.name).toBe('project-a');
  });

  test('missing workspace lookup returns undefined', () => {
    expect(db.getWorkspace('nope')).toBeUndefined();
  });

  test('renames a workspace', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'old-name' });
    db.updateWorkspace('ws-1', { name: 'new-name' });
    const ws = db.getWorkspace('ws-1');
    expect(ws!.name).toBe('new-name');
  });

  test('deletes a workspace', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    db.deleteWorkspace('ws-1');
    expect(db.listWorkspaces()).toHaveLength(0);
  });

  test('deleting a workspace cascades to its sessions', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    db.insertSession({
      id: 'sess-1', name: 'backend', status: 'active', repo: null,
      issue_repo: null, cwd: '/tmp', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    expect(db.listSessionsByWorkspace('ws-1')).toHaveLength(1);

    db.deleteWorkspace('ws-1');
    expect(db.listSessionsByWorkspace('ws-1')).toHaveLength(0);
    expect(db.getSession('sess-1')).toBeUndefined();
  });

  test('creates and lists multiple workspaces', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'alpha' });
    db.insertWorkspace({ id: 'ws-2', name: 'beta' });
    db.insertWorkspace({ id: 'ws-3', name: 'gamma' });
    expect(db.listWorkspaces()).toHaveLength(3);
  });
});

describe('App State (activeWorkspaceId / activeSessionId)', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('initial state: app state is empty', () => {
    expect(db.getAppState('activeWorkspaceId')).toBeUndefined();
    expect(db.getAppState('activeSessionId')).toBeUndefined();
  });

  test('sets and reads activeWorkspaceId', () => {
    db.setAppState('activeWorkspaceId', 'ws-1');
    expect(db.getAppState('activeWorkspaceId')).toBe('ws-1');
  });

  test('updates activeWorkspaceId', () => {
    db.setAppState('activeWorkspaceId', 'ws-1');
    db.setAppState('activeWorkspaceId', 'ws-2');
    expect(db.getAppState('activeWorkspaceId')).toBe('ws-2');
  });

  test('sets activeSessionId to null', () => {
    db.setAppState('activeSessionId', 'sess-1');
    db.setAppState('activeSessionId', null);
    // null is stored
    const val = db.getAppState('activeSessionId');
    expect(val === null || val === undefined).toBe(true);
  });
});

describe('Session + Workspace integration', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    db.insertWorkspace({ id: 'ws-2', name: 'project-b' });
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('session is created with workspace_id', () => {
    db.insertSession({
      id: 'sess-1', name: 'backend', status: 'active', repo: null,
      issue_repo: null, cwd: '/code/backend', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });

    const sessions = db.listSessionsByWorkspace('ws-1');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].workspace_id).toBe('ws-1');

    // Not present in other workspaces
    expect(db.listSessionsByWorkspace('ws-2')).toHaveLength(0);
  });

  test('sessions are isolated per workspace', () => {
    db.insertSession({
      id: 's1', name: 'api', status: 'active', repo: null,
      issue_repo: null, cwd: '/a', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    db.insertSession({
      id: 's2', name: 'web', status: 'active', repo: null,
      issue_repo: null, cwd: '/b', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    db.insertSession({
      id: 's3', name: 'blog', status: 'active', repo: null,
      issue_repo: null, cwd: '/c', workspace_id: 'ws-2',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });

    expect(db.listSessionsByWorkspace('ws-1')).toHaveLength(2);
    expect(db.listSessionsByWorkspace('ws-2')).toHaveLength(1);
    expect(db.listSessions()).toHaveLength(3); // all
  });

  test('deleting a workspace cascades to its sessions and panes', () => {
    db.insertSession({
      id: 's1', name: 'api', status: 'active', repo: null,
      issue_repo: null, cwd: '/a', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    db.insertPane({
      id: 'p1', type: 'agent', cmd: 'claude', cwd: '/tmp', status: 'running',
      session_id: 's1', created_at: new Date().toISOString(),
    });

    expect(db.getPane('p1')).toBeDefined();

    db.deleteWorkspace('ws-1');
    expect(db.getSession('s1')).toBeUndefined();
    expect(db.getPane('p1')).toBeUndefined();
  });
});

describe('Workspace ghProfile', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('gh_profile defaults to null on workspace creation', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    const ws = db.getWorkspace('ws-1');
    expect(ws!.gh_profile).toBeNull();
  });

  test('sets gh_profile', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    db.updateWorkspace('ws-1', { gh_profile: 'octo-user' });
    const ws = db.getWorkspace('ws-1');
    expect(ws!.gh_profile).toBe('octo-user');
  });

  test('updates gh_profile', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    db.updateWorkspace('ws-1', { gh_profile: 'user-a' });
    db.updateWorkspace('ws-1', { gh_profile: 'user-b' });
    const ws = db.getWorkspace('ws-1');
    expect(ws!.gh_profile).toBe('user-b');
  });

  test('clears gh_profile back to null', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'project-a' });
    db.updateWorkspace('ws-1', { gh_profile: 'some-user' });
    db.updateWorkspace('ws-1', { gh_profile: null });
    const ws = db.getWorkspace('ws-1');
    expect(ws!.gh_profile).toBeNull();
  });

  test('workspace list includes gh_profile', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'alpha' });
    db.insertWorkspace({ id: 'ws-2', name: 'beta' });
    db.updateWorkspace('ws-1', { gh_profile: 'octo' });
    const list = db.listWorkspaces();
    expect(list[0].gh_profile).toBe('octo');
    expect(list[1].gh_profile).toBeNull();
  });

  test('reads gh_profile via session → workspace', () => {
    db.insertWorkspace({ id: 'ws-1', name: 'vox' });
    db.updateWorkspace('ws-1', { gh_profile: 'octo-user' });
    db.insertSession({
      id: 's1', name: 'main', status: 'active', repo: 'org/app',
      issue_repo: null, cwd: '/code', workspace_id: 'ws-1',
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });

    // session → workspace_id → workspace → gh_profile
    const sess = db.getSession('s1')!;
    const ws = db.getWorkspace(sess.workspace_id!)!;
    expect(ws.gh_profile).toBe('octo-user');
  });

  test('session without a workspace has no gh_profile', () => {
    db.insertSession({
      id: 's1', name: 'orphan', status: 'active', repo: null,
      issue_repo: null, cwd: '/tmp', workspace_id: null,
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });

    const sess = db.getSession('s1')!;
    expect(sess.workspace_id).toBeNull();
    // With workspace_id null, there's no gh_profile to look up.
  });
});

describe('Session creation without a workspace', () => {
  let db: DbService;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.onModuleDestroy();
  });

  test('session can be created without a workspace (workspace_id = null)', () => {
    db.insertSession({
      id: 's1', name: 'orphan', status: 'active', repo: null,
      issue_repo: null, cwd: '/tmp', workspace_id: null,
      parent_session_id: null, issue_number: null,
      worktree_path: null, branch: null, created_at: new Date().toISOString(),
    });
    const sess = db.getSession('s1');
    expect(sess).toBeDefined();
    expect(sess!.workspace_id).toBeNull();
  });
});
