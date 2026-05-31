# cltree demo pipeline

Automatically produces the cltree demo video, GIF, and captions in one shot.

## Artifacts

```
dist/demo/
├── raw.webm       # Puppeteer page.screencast raw output
├── captions.srt   # Captions synced to actions (English)
├── demo.mp4       # Captions burned in, H.264 1280×720
└── demo.gif       # 960px wide, 12fps — README / Product Hunt
```

## Usage

```bash
# 1. Record (headed browser, ~30 seconds)
pnpm demo:record

# 2. Compose captions + extract GIF
pnpm demo:post

# Or all in one
pnpm demo
```

Requirements: macOS / Linux. ffmpeg ships with the npm package `@ffmpeg-installer/ffmpeg`, so no system install is needed.

## Layout

| File | Role |
|---|---|
| `captions.ts` | Caption emit helper — publishes text at action timestamps, serializes to SRT |
| `api-client.ts` | cltree HTTP API wrapper (POST /api/cli) |
| `scenario.ts` | Demo scenario (Workspace → Session → Claude+Codex → GUI pane → Worktree) |
| `record.ts` | Dev server spawn + Puppeteer recording orchestrator |
| `postprocess.ts` | ffmpeg subtitles burn-in + palettegen GIF |

## Editing the scenario

Just edit `scenario.ts`. Each `captions.emit("...")` call timestamp becomes the caption start time, so use `sleep` to control how long each caption stays on screen.

```ts
captions.emit('Spawn a Claude Code agent');
await client.cli(['p', 'spawn', '--session', sessionId, '--cmd', 'claude ...']);
await sleep(2500);  // This caption is displayed for 2.5 seconds
```

## Caption styling

Edit the `style` object in `postprocess.ts`. The current preset is minimal, bottom-left, with a semi-transparent zinc-900 box (matching the Claude design tone).

## Multilingual captions

In `scenario.ts`, create two `captions` instances and emit English and Korean text into each, then call `toSrt()`. Running ffmpeg one more time with `-vf subtitles=ko.srt` produces a separate Korean burn-in version.
