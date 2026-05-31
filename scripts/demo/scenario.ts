/**
 * cltree demo scenario.
 *
 * Flow:
 *   1. Create and switch to a workspace
 *   2. Create a session
 *   3. Spawn a Claude Code agent (left pane)
 *   4. Open the GitHub issue it is working on as a GUI pane (right pane)
 *   5. Force a side-by-side (horizontal) layout: Claude Code | Issue
 *
 * Captions are emitted at each action and are auto-serialized to SRT.
 */

import { CltreeClient, sleep } from './api-client.js';
import { CaptionRecorder } from './captions.js';
import type { Page } from 'puppeteer';

interface ScenarioContext {
  client: CltreeClient;
  page: Page;
  captions: CaptionRecorder;
}

/** Mock issue data — rendered by the Issue GUI pane (IssueViewData shape). */
const DEMO_ISSUE = {
  number: 42,
  title: 'Add dark mode toggle to settings',
  state: 'open' as const,
  labels: [
    { name: 'enhancement', color: 'a2eeef' },
    { name: 'good first issue', color: '7057ff' },
  ],
  assignees: ['alice'],
  body: [
    '## Summary',
    'Users want a dark mode toggle in the settings view.',
    '',
    '## Acceptance criteria',
    '- [ ] Toggle control in Settings',
    '- [ ] Persist the preference',
    '- [ ] Respect the OS-level color scheme',
  ].join('\n'),
  comments: [
    { author: 'bob', body: 'Happy to review once the toggle is wired up.', createdAt: '2026-05-30T10:00:00Z' },
  ],
};

/** Trigger a UI re-render — reload so React picks up the backend state changes. */
async function refreshUI(page: Page): Promise<void> {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 5000 });
  } catch {
    /* keep going even if reload fails */
  }
  await sleep(800);
}

export async function runScenario(ctx: ScenarioContext): Promise<void> {
  const { client, page, captions } = ctx;

  // ── 0. Intro ──
  captions.emit('cltree — CLI-first multi-agent orchestrator');
  await sleep(2500);

  // ── 1. Create workspace ──
  captions.emit('Create a workspace');
  const wsName = `demo-${Date.now().toString().slice(-5)}`;
  const wsRes = await client.cli<{ workspace: { id: string } }>(['w', 'create', '--name', wsName]);
  if (!wsRes.ok) throw new Error(`workspace create failed: ${wsRes.error}`);
  await client.cli(['w', 'switch', wsRes.data.workspace.id]);
  await refreshUI(page);
  await sleep(1500);

  // ── 2. Create session (sessionService.switchTo is handled internally) ──
  captions.emit('Start a session in this directory');
  const sName = 'dark-mode';
  const sRes = await client.cli<{ session: { id: string } }>(
    ['s', 'create', '--name', sName, '--cwd', process.cwd()],
  );
  if (!sRes.ok || !sRes.data?.session) throw new Error(`session create failed: ${sRes.error}`);
  const sessionId = sRes.data.session.id;
  await refreshUI(page);
  await sleep(1500);

  // ── 3. Spawn Claude agent (demo dummy: invoking the real claude binary could clash with the current Claude Code session) ──
  captions.emit('Spawn a Claude Code agent');
  const claudeMock = `bash -lc 'printf "\\033[1;36m▌ Claude Code\\033[0m (sonnet 4.7)\\n> Connected to cltree session\\n> Working on issue #42 — dark mode toggle…\\n"; tail -f /dev/null'`;
  const spawnRes = await client.cli<{ pane: { id: string } }>(
    ['p', 'spawn', '--session', sessionId, '--cmd', claudeMock],
  );
  if (!spawnRes.ok || !spawnRes.data?.pane) throw new Error(`spawn failed: ${spawnRes.error}`);
  const claudePaneId = spawnRes.data.pane.id;
  await refreshUI(page);
  await sleep(2500);

  // ── 4. Open the GitHub issue as a GUI pane (right side) ──
  captions.emit('Open the GitHub issue right beside it');
  const issueGuiId = `gui-issue-${Date.now()}`;
  const issueSlotId = `slot-issue-${Date.now()}`;
  await client.cli(['p', 'view-register'], {
    id: issueGuiId,
    viewType: 'issue',
    sessionId,
    slotId: issueSlotId,
    meta: DEMO_ISSUE,
  });

  // ── 5. Force a side-by-side (horizontal) layout: Claude Code | Issue ──
  // The saved layout is restored verbatim on the next page reload.
  await client.cli(['layout', 'save', sessionId], {
    id: `split-${Date.now()}`,
    type: 'split',
    direction: 'horizontal',
    children: [
      { type: 'leaf', paneId: claudePaneId },
      { type: 'leaf', paneId: issueGuiId },
    ],
    sizes: [55, 45],
  });
  await refreshUI(page);
  await sleep(3000);

  captions.emit('Read the issue, drive the agent — side by side');
  await sleep(3500);

  // ── 6. Closing ──
  captions.emit('One issue → one worktree → one agent. The orchestrator wires it together.');
  await sleep(3500);

  captions.emit('cltree — open source soon');
  await sleep(2500);

  // Keep the page reference so TS doesn't complain (Puppeteer work is already done on `page`).
  void page;
}
