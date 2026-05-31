/**
 * cltree demo scenario.
 *
 * Flow:
 *   1. Create and switch to a workspace
 *   2. Create a session
 *   3. Spawn Claude + Codex side by side (one session, two agents)
 *   4. Bring up an Issue View in a GUI Pane
 *   5. Visualize session switching
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
  const sName = 'multi-agent';
  const sRes = await client.cli<{ session: { id: string } }>(
    ['s', 'create', '--name', sName, '--cwd', process.cwd()],
  );
  if (!sRes.ok || !sRes.data?.session) throw new Error(`session create failed: ${sRes.error}`);
  const sessionId = sRes.data.session.id;
  await refreshUI(page);
  await sleep(1500);

  // ── 3-1. Spawn Claude agent (demo dummy: invoking the real claude binary could clash with the current Claude Code session) ──
  captions.emit('Spawn a Claude Code agent');
  const claudeMock = `bash -lc 'printf "\\033[1;36m▌ Claude Code\\033[0m (sonnet 4.7)\\n> Connected to cltree session\\n> Awaiting instructions…\\n"; tail -f /dev/null'`;
  await client.cli(['p', 'spawn', '--session', sessionId, '--cmd', claudeMock]);
  await refreshUI(page);
  await sleep(2500);

  // ── 3-2. Spawn Codex agent (same session) ──
  captions.emit('Add an OpenAI Codex agent — same session');
  const codexMock = `bash -lc 'printf "\\033[1;33m▌ OpenAI Codex\\033[0m (codex-cli 0.39)\\n> Sandbox: workspace-write\\n> Ready.\\n"; tail -f /dev/null'`;
  await client.cli(['p', 'spawn', '--session', sessionId, '--cmd', codexMock]);
  await refreshUI(page);
  await sleep(2500);

  captions.emit('Two AI agents, side by side, sharing the same workspace');
  await sleep(3000);

  // ── 4. Worktree branching — issue-driven sub-session ──
  captions.emit('Branch an issue into its own worktree session');
  // Real git worktree creation requires a suitable environment. The demo continues even on failure.
  try {
    await client.cli(['s', 'create', '--parent', sessionId, '--issue', '42', '--spawn']);
    await refreshUI(page);
  } catch {
    /* worktree demo is optional */
  }
  await sleep(3000);

  captions.emit('Issues, worktrees, multiple agents — all in one workspace');
  await sleep(3500);

  // ── 6. Closing ──
  captions.emit('Same orchestrator. Multiple agents. Real workflows.');
  await sleep(3500);

  captions.emit('cltree — open source soon');
  await sleep(2500);

  // Keep the page reference so TS doesn't complain (Puppeteer work is already done on `page`).
  void page;
}
