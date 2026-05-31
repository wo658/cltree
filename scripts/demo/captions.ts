/**
 * Caption collector.
 *
 * Call `emit()` whenever an action happens during scenario playback, and the
 * elapsed time since recording started is recorded.
 * On shutdown, `toSrt()` returns the SRT-formatted string.
 *
 * Each caption is displayed from its `emit()` timestamp until the next
 * `emit()` call, and the final caption is displayed until `finish()` is called.
 */

export interface CaptionEntry {
  /** ms from recording start */
  startMs: number;
  /** ms from recording start */
  endMs: number;
  /** UTF-8 caption text */
  text: string;
}

export class CaptionRecorder {
  private startedAt = 0;
  private pending: { startMs: number; text: string }[] = [];
  private finalized: CaptionEntry[] = [];

  /** Mark the recording start timestamp. */
  start(): void {
    this.startedAt = Date.now();
    this.pending = [];
    this.finalized = [];
  }

  /** Publish a new caption. The previous caption is finalized at this moment. */
  emit(text: string): void {
    if (this.startedAt === 0) {
      throw new Error('CaptionRecorder.start() must be called before emit()');
    }
    const now = Date.now() - this.startedAt;
    // Finalize the previous caption.
    const last = this.pending.pop();
    if (last) {
      this.finalized.push({ startMs: last.startMs, endMs: now, text: last.text });
    }
    this.pending.push({ startMs: now, text });
    // eslint-disable-next-line no-console
    console.log(`[caption ${formatTimeShort(now)}] ${text}`);
  }

  /** Call at the end of the recording to finalize the last caption. */
  finish(): void {
    const now = Date.now() - this.startedAt;
    const last = this.pending.pop();
    if (last) {
      this.finalized.push({ startMs: last.startMs, endMs: now, text: last.text });
    }
  }

  /** Return all caption entries. */
  entries(): CaptionEntry[] {
    return [...this.finalized].sort((a, b) => a.startMs - b.startMs);
  }

  /** Serialize all entries as an SRT-format string. */
  toSrt(): string {
    const lines: string[] = [];
    this.entries().forEach((entry, i) => {
      lines.push(String(i + 1));
      lines.push(`${formatSrtTime(entry.startMs)} --> ${formatSrtTime(entry.endMs)}`);
      lines.push(entry.text);
      lines.push('');
    });
    return lines.join('\n');
  }
}

/** SRT timestamp format: HH:MM:SS,mmm */
function formatSrtTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(milli, 3)}`;
}

/** Short log format: MM:SS.mmm */
function formatTimeShort(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const milli = ms % 1000;
  return `${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
