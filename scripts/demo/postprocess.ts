/**
 * Post-process pipeline:
 *   raw.webm + captions.srt
 *     → demo.mp4 (captions burned in, H.264)
 *     → demo.gif (GIF for README / Product Hunt, 720p, ~10fps)
 *
 * The ffmpeg binary is sourced from @ffmpeg-installer/ffmpeg (no system install required).
 */

import { execFileSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, resolve } from 'path';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';

const PROJECT_ROOT = resolve(__dirname, '../..');
const OUT_DIR = join(PROJECT_ROOT, 'dist/demo');
const RAW = join(OUT_DIR, 'raw.mp4');
const SRT = join(OUT_DIR, 'captions.srt');
const MP4 = join(OUT_DIR, 'demo.mp4');
const GIF = join(OUT_DIR, 'demo.gif');
const PALETTE = join(OUT_DIR, 'palette.png');

const FFMPEG = ffmpegInstaller.path;

function run(args: string[]): void {
  console.log(`  $ ffmpeg ${args.join(' ')}`);
  execFileSync(FFMPEG, args, { stdio: 'inherit' });
}

function assertExists(path: string, hint: string): void {
  if (!existsSync(path)) {
    throw new Error(`missing ${path}${hint ? ' — ' + hint : ''}`);
  }
}

function main(): void {
  console.log(`ffmpeg binary: ${FFMPEG}`);
  assertExists(RAW, 'run `pnpm tsx scripts/demo/record.ts` first');
  assertExists(SRT, 'run record.ts first');

  // ── 1. Burn captions in (Claude design tone: minimal, left-aligned, soft) ──
  console.log('\n[1/3] Burning captions into MP4…');
  // Escape colons (:) in the SRT path — ffmpeg subtitles filter quirk.
  const srtForFilter = SRT.replace(/:/g, '\\:').replace(/'/g, "\\'");
  // ASS color format: &HAABBGGRR (alpha 0=opaque, FF=transparent)
  const style = [
    'FontName=Helvetica Neue',
    'FontSize=22',
    'Bold=1',
    'PrimaryColour=&H00FFFFFF',     // fully opaque white
    'OutlineColour=&H00000000',     // black outline
    'BackColour=&HA0181818',        // ~60% opaque zinc-900 box
    'BorderStyle=4',                 // box background mode
    'Outline=14',                    // box padding
    'Shadow=0',
    'Alignment=1',                   // bottom-left alignment
    'MarginL=48',
    'MarginV=48',
  ].join(',');

  run([
    '-y',
    '-i', RAW,
    '-vf', `subtitles='${srtForFilter}':force_style='${style}'`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '20',
    '-preset', 'medium',
    '-movflags', '+faststart',
    MP4,
  ]);
  console.log(`  → ${MP4} (${humanSize(MP4)})`);

  // ── 2. Extract palette (for high-quality GIF) ──
  console.log('\n[2/3] Generating GIF palette…');
  run([
    '-y',
    '-i', MP4,
    '-vf', 'fps=12,scale=960:-1:flags=lanczos,palettegen=stats_mode=diff',
    PALETTE,
  ]);

  // ── 3. Generate GIF (apply palette) ──
  console.log('\n[3/3] Encoding GIF…');
  run([
    '-y',
    '-i', MP4,
    '-i', PALETTE,
    '-lavfi', 'fps=12,scale=960:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5',
    GIF,
  ]);
  console.log(`  → ${GIF} (${humanSize(GIF)})`);

  console.log('\n✓ Post-process complete');
  console.log(`\nArtifacts in ${OUT_DIR}:`);
  for (const p of [MP4, GIF, SRT, RAW]) {
    if (existsSync(p)) console.log(`  ${humanSize(p).padStart(10)}  ${p.replace(PROJECT_ROOT + '/', '')}`);
  }
}

function humanSize(path: string): string {
  if (!existsSync(path)) return '—';
  const bytes = statSync(path).size;
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

try {
  main();
} catch (err) {
  console.error('FATAL:', (err as Error).message);
  process.exit(1);
}
