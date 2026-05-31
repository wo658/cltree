#!/usr/bin/env node

/**
 * cltree CLI entry point.
 *
 * No args     → start server (current directory = default session cwd)
 * With args   → send HTTP request to running server (client mode)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const CLTREE_DIR = path.join(os.homedir(), '.cltree');
const LOCK_FILE = path.join(CLTREE_DIR, 'cltree.lock');

const args = process.argv.slice(2);

if (args.length === 0) {
  // ─── Server mode: start the NestJS server ───
  startServer();
} else {
  // ─── Client mode: send a command to the running server ───
  sendCommand(args);
}

/** Start the server (current directory becomes the default session cwd) */
function startServer() {
  // Check whether an instance is already running
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      // Check whether the PID is alive
      try {
        process.kill(lock.pid, 0);
        console.log(`cltree is already running (PID ${lock.pid}, http://localhost:${lock.port})`);
        console.log('Example: cltree s list');
        process.exit(0);
      } catch {
        // PID is dead — remove stale lock
        fs.unlinkSync(LOCK_FILE);
      }
    } catch {
      fs.unlinkSync(LOCK_FILE);
    }
  }

  // Pass the default session cwd via the CLTREE_CWD env var
  process.env.CLTREE_CWD = process.cwd();

  // Load and run the NestJS server module
  const serverMain = path.resolve(__dirname, '..', 'dist', 'server', 'server', 'main.js');
  if (!fs.existsSync(serverMain)) {
    console.error('Server is not built. Run `pnpm build` first.');
    process.exit(1);
  }

  require(serverMain);
}

/** Send a CLI command to the running server */
function sendCommand(cmd) {
  // If CLTREE_SESSION_ID is set and --session is not provided, inject it automatically.
  // This binds calls from inside an agent PTY to its own session.
  if (process.env.CLTREE_SESSION_ID && !cmd.includes('--session')) {
    cmd = [...cmd, '--session', process.env.CLTREE_SESSION_ID];
  }
  if (!fs.existsSync(LOCK_FILE)) {
    console.error('cltree server is not running.');
    console.error('Start cltree first.');
    process.exit(1);
  }

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
  } catch {
    console.error('Failed to read lock file.');
    process.exit(1);
  }

  const body = JSON.stringify({ cmd });
  const req = http.request(
    {
      hostname: 'localhost',
      port: lock.port,
      path: '/api/cli',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.ok) {
            // Human-readable output
            printResult(result);
          } else {
            console.error('Error:', result.error);
            process.exit(1);
          }
        } catch {
          console.log(data);
        }
      });
    },
  );

  req.on('error', () => {
    console.error('Cannot connect to server. Make sure cltree is running.');
    process.exit(1);
  });

  req.write(body);
  req.end();
}

/** Print the CLI response in a human-readable form */
function printResult(result) {
  // -j flag prints raw JSON
  if (process.argv.includes('-j') || process.argv.includes('--json')) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  const data = result.data;

  // Per-type formatting
  if (data?.workspaces) {
    // w list
    if (data.workspaces.length === 0) {
      console.log('No workspaces');
    } else {
      for (const ws of data.workspaces) {
        const desc = ws.description ? ` — ${ws.description}` : '';
        const sessCount = ws.sessions?.length || 0;
        console.log(`  ${ws.id.slice(0, 8)}  ${ws.name}${desc}  (${sessCount} sessions)`);
      }
    }
  } else if (data?.workspace) {
    // w create
    const ws = data.workspace;
    console.log(`Workspace: ${ws.name} (${ws.id.slice(0, 8)})`);
  } else if (data?.sessions) {
    // s list
    if (data.sessions.length === 0) {
      console.log('No sessions');
    } else {
      for (const s of data.sessions) {
        const repo = s.repo ? ` (${s.repo})` : '';
        console.log(`  ${s.id.slice(0, 8)}  ${s.name}${repo}  [${s.status}]  ${s.cwd}`);
        for (const child of s.children || []) {
          console.log(`    └─ ${child.id.slice(0, 8)}  ${child.name}  [${child.status}]`);
        }
      }
    }
  } else if (data?.session) {
    // s create, s inspect
    const s = data.session;
    console.log(`Session created: ${s.name} (${s.id.slice(0, 8)})`);
    console.log(`  cwd: ${s.cwd}`);
    if (s.repo) console.log(`  repo: ${s.repo}`);
    if (s.issueRepo && s.issueRepo !== s.repo) console.log(`  issueRepo: ${s.issueRepo}`);
    if (data.spawnedPane) console.log(`  agent: ${data.spawnedPane.cmd} (${data.spawnedPane.id.slice(0, 8)})`);
  } else if (data?.pane) {
    // p spawn, p attach
    const p = data.pane;
    console.log(`Pane created: [${p.type}] ${p.cmd} (${p.id.slice(0, 8)})`);
  } else if (data?.deleted) {
    console.log(`Deleted: ${data.deleted.slice(0, 8)}`);
  } else if (data?.switched) {
    console.log(`Switched session: ${data.switched.slice(0, 8)}`);
  } else if (data?.removed) {
    console.log(`Removed: ${data.removed.slice(0, 8)}`);
  } else if (data?.killed) {
    console.log(`Killed: ${data.killed.slice(0, 8)}`);
  } else if (data?.started !== undefined && data?.sessionId) {
    console.log(`Session started: ${data.sessionId.slice(0, 8)} (${data.started} pane(s))`);
  } else if (data?.stopped !== undefined && data?.sessionId) {
    console.log(`Session stopped: ${data.sessionId.slice(0, 8)} (${data.stopped} pane(s))`);
  } else if (data?.config || data?.agent || data?.key !== undefined) {
    // cfg get/set/agent/info
    if (data.agent) {
      console.log('Agent config:');
      for (const [k, v] of Object.entries(data.agent)) {
        console.log(`  ${k}: ${JSON.stringify(v)}`);
      }
    } else if (data.key !== undefined) {
      console.log(`${data.key}: ${JSON.stringify(data.value)}`);
    } else if (data.config) {
      console.log(JSON.stringify(data.config, null, 2));
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  } else if (data?.issues) {
    // issue list
    if (data.issues.length === 0) {
      console.log('No issues');
    } else {
      for (const i of data.issues) {
        const labels = i.labels.map((l) => l.name).join(', ');
        console.log(`  #${i.number}  ${i.title}  ${labels ? `[${labels}]` : ''}`);
      }
    }
  } else {
    // Default: raw JSON
    console.log(JSON.stringify(data, null, 2));
  }

  // Suggested next actions
  if (result.actions?.length > 0) {
    console.log('');
    console.log('Next:');
    for (const a of result.actions) {
      console.log(`  cltree ${a.cmd.join(' ')}  — ${a.desc}`);
    }
  }
}
