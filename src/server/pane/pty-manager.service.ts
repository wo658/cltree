import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { execSync } from 'child_process';

/** Internal representation of a PTY instance */
interface PtyInstance {
  id: string;
  process: pty.IPty;
  sessionId: string;
  /** Recent output data (for replaying on WebSocket reconnect) */
  ringBuffer: string[];
}

/**
 * node-pty wrapper service.
 * Manages creation, deletion, and data streaming for all PTY processes.
 * The Gateway subscribes to 'pty-data' and 'pty-exit' events to forward them over WebSocket.
 */
@Injectable()
export class PtyManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(PtyManagerService.name);
  private readonly instances = new Map<string, PtyInstance>();
  private readonly events = new EventEmitter();

  /** Maximum ring buffer size */
  private static readonly RING_BUFFER_MAX = 1000;

  /** Spawn a PTY process */
  spawn(opts: {
    id: string;
    sessionId: string;
    cmd?: string;
    args?: string[];
    shell?: string;
    cwd: string;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
  }): void {
    const shell = opts.shell || opts.cmd || process.env.SHELL || '/bin/bash';
    const args = opts.args ?? [];

    const env = opts.env
      ? { ...(process.env as Record<string, string>), ...opts.env }
      : (process.env as Record<string, string>);

    const ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      cwd: opts.cwd,
      env,
    });

    const instance: PtyInstance = {
      id: opts.id,
      process: ptyProcess,
      sessionId: opts.sessionId,
      ringBuffer: [],
    };

    ptyProcess.onData((data: string) => {
      instance.ringBuffer.push(data);
      if (instance.ringBuffer.length > PtyManagerService.RING_BUFFER_MAX) {
        instance.ringBuffer.shift();
      }
      this.events.emit('pty-data', {
        paneId: opts.id,
        sessionId: opts.sessionId,
        data,
      });
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.logger.log(`PTY exited: pane=${opts.id}, exitCode=${exitCode}`);
      this.instances.delete(opts.id);
      this.events.emit('pty-exit', {
        paneId: opts.id,
        sessionId: opts.sessionId,
        exitCode,
      });
    });

    this.instances.set(opts.id, instance);
    this.logger.log(`PTY spawned: pane=${opts.id}, shell=${shell}, cwd=${opts.cwd}`);
  }

  /** Write data to a PTY (user input) */
  write(paneId: string, data: string): void {
    const instance = this.instances.get(paneId);
    if (instance) {
      instance.process.write(data);
    }
  }

  /** Resize the PTY terminal */
  resize(paneId: string, cols: number, rows: number): void {
    const instance = this.instances.get(paneId);
    if (instance) {
      instance.process.resize(cols, rows);
    }
  }

  /** Kill a PTY process */
  kill(paneId: string): void {
    const instance = this.instances.get(paneId);
    if (instance) {
      instance.process.kill();
      this.instances.delete(paneId);
      this.logger.log(`PTY force-killed: pane=${paneId}`);
    }
  }

  /** Retrieve the ring buffer (for replaying on WebSocket reconnect) */
  getRingBuffer(paneId: string): string[] {
    return this.instances.get(paneId)?.ringBuffer ?? [];
  }

  /** Check if a PTY instance exists */
  has(paneId: string): boolean {
    return this.instances.has(paneId);
  }

  /** Get all PTY IDs for a specific session */
  getPaneIdsBySession(sessionId: string): string[] {
    const ids: string[] = [];
    for (const [id, inst] of this.instances) {
      if (inst.sessionId === sessionId) {
        ids.push(id);
      }
    }
    return ids;
  }

  /** Get the current ring buffer size */
  getRingBufferSize(paneId: string): number {
    return this.instances.get(paneId)?.ringBuffer.length ?? 0;
  }

  /** Convert the ring buffer to an array of text lines (last N lines) */
  getRingBufferAsText(paneId: string, lines = 50, plain = false): string[] {
    const buffer = this.getRingBuffer(paneId);
    if (buffer.length === 0) return [];
    let text = buffer.join('');
    if (plain) text = this.stripAnsi(text);
    const allLines = text.split('\n');
    return allLines.slice(-lines);
  }

  /** Strip ANSI escape codes */
  private stripAnsi(text: string): string {
    return text
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')     // CSI sequences
      .replace(/\x1B\][^\x07]*\x07/g, '')          // OSC sequences
      .replace(/\x1B[()][AB012]/g, '')              // Character set selection
      .replace(/\x1B[\x20-\x2F][\x40-\x7E]/g, ''); // Other 2-byte sequences
  }

  /** Get the current working directory of a PTY process (macOS/Linux) */
  getCwd(paneId: string): string | null {
    const instance = this.instances.get(paneId);
    if (!instance) return null;
    const pid = instance.process.pid;
    try {
      // macOS: lsof -a -d cwd -p <pid> -F n
      const out = execSync(`lsof -a -d cwd -p ${pid} -F n 2>/dev/null`, { encoding: 'utf8', timeout: 3000 });
      const match = out.match(/^n(.+)$/m);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /** Register an event listener */
  on(event: string, listener: (...args: unknown[]) => void): void {
    this.events.on(event, listener);
  }

  /** Remove an event listener */
  off(event: string, listener: (...args: unknown[]) => void): void {
    this.events.off(event, listener);
  }

  /**
   * Call callback when the PTY becomes idle (no output).
   * Considered ready after idleMs with no output. Forces execution after maxWaitMs.
   */
  waitForIdle(paneId: string, idleMs: number, maxWaitMs: number): Promise<void> {
    return new Promise((resolve) => {
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const maxTimer = setTimeout(() => {
        cleanup();
        resolve();
      }, maxWaitMs);

      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          cleanup();
          resolve();
        }, idleMs);
      };

      const onData = (evt: { paneId: string }) => {
        if (evt.paneId === paneId) resetIdle();
      };

      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        this.events.off('pty-data', onData as (...args: unknown[]) => void);
      };

      this.events.on('pty-data', onData as (...args: unknown[]) => void);
      // Start the initial idle timer
      resetIdle();
    });
  }

  /** Kill all PTY processes (on server shutdown) */
  killAll(): void {
    for (const [, inst] of this.instances) {
      inst.process.kill();
    }
    this.instances.clear();
    this.logger.log('All PTY processes terminated');
  }

  /** Clean up when the NestJS module is destroyed */
  onModuleDestroy(): void {
    this.killAll();
  }
}
