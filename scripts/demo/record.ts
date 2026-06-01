/**
 * Demo recording orchestrator.
 *
 * 1. Spawn the cltree dev server in the background (reuse if one is already running).
 * 2. Launch a Puppeteer browser and start recording to dist/demo/raw.webm.
 * 3. Run scenario.ts — captions are written to captions.srt in parallel.
 * 4. Stop the recording and clean up the dev server.
 *
 * Usage:
 *   pnpm tsx scripts/demo/record.ts
 *   or pnpm demo (package.json script)
 */

import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, writeFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import puppeteer from 'puppeteer';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { CltreeClient, sleep } from './api-client.js';
import { CaptionRecorder } from './captions.js';
import { runScenario } from './scenario.js';

// Point the ffmpeg that puppeteer's page.screencast() spawns at our bundled binary.
process.env.PATH = `${dirname(ffmpegInstaller.path)}:${process.env.PATH || ''}`;

const PROJECT_ROOT = resolve(__dirname, '../..');
const OUT_DIR = join(PROJECT_ROOT, 'dist/demo');
const DEV_PORT = 4870;
const WEB_PORT = 5173;
const BASE_URL = `http://localhost:${WEB_PORT}`;
const API_URL = `http://localhost:${DEV_PORT}`;

const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log('▶ Starting cltree dev server (or reusing existing)…');
  const devProc = await ensureDevServer();
  const ownsServer = devProc !== null;

  try {
    const client = new CltreeClient(API_URL);
    console.log('  waiting for /api/cli to respond…');
    await client.waitForReady(90_000);
    console.log('  server ready ✓');

    // We intentionally do not wipe existing data — assume the user has cleaned up beforehand.
    // (Instead we append a timestamp suffix to the workspace name to avoid collisions.)

    console.log('▶ Launching Puppeteer…');
    // xterm.js fails to render in headless mode due to a dimensions error, so headed is the default.
    // Set DEMO_HEADLESS=1 to force headless explicitly (useful for sidebar-only demos).
    const headless = process.env.DEMO_HEADLESS === '1';
    const browser = await puppeteer.launch({
      headless,
      defaultViewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT },
      args: [
        `--window-size=${VIDEO_WIDTH},${VIDEO_HEIGHT + 80}`,
        '--disable-blink-features=AutomationControlled',
        '--no-default-browser-check',
        '--no-first-run',
        '--hide-scrollbars',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: VIDEO_WIDTH, height: VIDEO_HEIGHT });

    // Force xterm's DOM renderer instead of WebGL — puppeteer screenshots cannot
    // capture the WebGL canvas (terminal panes would record as solid black).
    await page.evaluateOnNewDocument(() => {
      (window as unknown as { __CLTREE_NO_WEBGL__?: boolean }).__CLTREE_NO_WEBGL__ = true;
    });

    console.log(`▶ Navigating to ${BASE_URL}…`);
    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
    } catch (err) {
      console.warn(`  navigation slow, proceeding anyway: ${(err as Error).message}`);
    }
    await sleep(2000); // Let the initial UI render settle.

    const rawPath = join(OUT_DIR, 'raw.mp4');
    const fps = 12;
    console.log(`▶ Starting screenshot-based recorder → ${rawPath} @ ${fps}fps`);
    console.log(`  ffmpeg: ${ffmpegInstaller.path}`);

    // Workaround for a headless Chrome quirk where CDP screencast emits no frames:
    // periodically call page.screenshot() and pipe PNGs into ffmpeg via image2pipe.
    const frames: Buffer[] = [];
    let captureBusy = false;
    const captureInterval = setInterval(() => {
      if (captureBusy) return;
      captureBusy = true;
      page.screenshot({ type: 'png', encoding: 'binary', omitBackground: false })
        .then((buf) => {
          frames.push(buf as Buffer);
        })
        .catch(() => { /* page may be navigating */ })
        .finally(() => { captureBusy = false; });
    }, Math.floor(1000 / fps));

    const captions = new CaptionRecorder();
    captions.start();

    try {
      await runScenario({ client, page, captions });
    } catch (err) {
      console.error('  scenario error:', err);
    }

    captions.finish();
    console.log('▶ Stopping recorder…');
    clearInterval(captureInterval);
    // Wait briefly for any in-flight capture to settle.
    await sleep(500);

    console.log(`  captured ${frames.length} frames, encoding…`);
    await encodeFramesToMp4(frames, rawPath, fps, ffmpegInstaller.path);

    const srtPath = join(OUT_DIR, 'captions.srt');
    writeFileSync(srtPath, captions.toSrt());
    console.log(`  captions saved → ${srtPath}`);
    console.log(`  ${captions.entries().length} entries`);

    await browser.close();
    console.log('✓ Recording complete');
    console.log(`\nNext step: pnpm tsx scripts/demo/postprocess.ts`);
  } finally {
    if (ownsServer && devProc) {
      console.log('▶ Stopping dev server we started…');
      try {
        process.kill(-devProc.pid!, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
  }
}

/** Return null if the dev server is already running, otherwise spawn one and return the ChildProcess. */
async function ensureDevServer(): Promise<ChildProcess | null> {
  // Quick health check.
  try {
    const res = await fetch(`${API_URL}/api/cli`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: ['w', 'list'] }),
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      console.log('  existing server detected — reusing');
      return null;
    }
  } catch {
    /* server not up */
  }

  console.log('  spawning `pnpm dev`…');
  const proc = spawn('pnpm', ['dev'], {
    cwd: PROJECT_ROOT,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, BROWSER: 'none' }, // Suppress Vite's auto browser-open.
  });
  proc.stdout?.on('data', (b) => process.stdout.write(`[dev] ${b}`));
  proc.stderr?.on('data', (b) => process.stderr.write(`[dev!] ${b}`));
  return proc;
}

void existsSync; void createWriteStream; // Reserved for future cleanup / streaming variants.

/**
 * Pipe an array of PNG frames into ffmpeg's stdin via image2pipe and encode to mp4 with libx264.
 */
async function encodeFramesToMp4(
  frames: Buffer[],
  outPath: string,
  fps: number,
  ffmpegPath: string,
): Promise<void> {
  if (frames.length === 0) {
    throw new Error('no frames captured');
  }
  return new Promise<void>((resolveProm, reject) => {
    const proc = spawn(
      ffmpegPath,
      [
        '-y',
        '-f', 'image2pipe',
        '-framerate', String(fps),
        '-vcodec', 'png',
        '-i', 'pipe:0',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '22',
        '-preset', 'medium',
        '-vf', `pad=ceil(iw/2)*2:ceil(ih/2)*2`, // libx264 requires even dimensions.
        '-movflags', '+faststart',
        outPath,
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    proc.on('close', (code) => {
      if (code === 0) resolveProm();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on('error', reject);
    // Write frames sequentially — handle backpressure.
    (async () => {
      for (const f of frames) {
        if (!proc.stdin.write(f)) {
          await new Promise<void>((r) => proc.stdin.once('drain', () => r()));
        }
      }
      proc.stdin.end();
    })().catch(reject);
  });
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
