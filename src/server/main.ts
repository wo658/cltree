/**
 * NestJS Bootstrap
 *
 * Main process entry point. Starts the HTTP + WebSocket server and
 * creates a lock file to ensure a single instance.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { createProxyMiddleware } from 'http-proxy-middleware';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';

interface ProxyRequest extends Request {
  _proxyTarget?: string;
}
import { PaneService } from './pane/pane.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Lock file path (~/.cltree/cltree.lock) */
const CLTREE_DIR = path.join(os.homedir(), '.cltree');
const LOCK_FILE = path.join(CLTREE_DIR, 'cltree.lock');

/** Delete lock file */
function removeLock(): void {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      fs.unlinkSync(LOCK_FILE);
    }
  } catch {
    // Ignore if deletion fails
  }
}

/** Sync assets/skill/ → ~/.claude/skills/cltree/ */
function syncSkillFiles(): void {
  const skillSrc = path.resolve(__dirname, '..', '..', '..', 'assets', 'skill');
  const skillDst = path.join(os.homedir(), '.claude', 'skills', 'cltree');

  if (!fs.existsSync(skillSrc)) return; // Skip if assets are absent from the build

  try {
    fs.mkdirSync(skillDst, { recursive: true });
    fs.mkdirSync(path.join(skillDst, 'references'), { recursive: true });

    // Compare file by file and copy if changed
    const copyIfChanged = (src: string, dst: string) => {
      if (!fs.existsSync(src)) return;
      const srcContent = fs.readFileSync(src, 'utf-8');
      const dstContent = fs.existsSync(dst) ? fs.readFileSync(dst, 'utf-8') : '';
      if (srcContent !== dstContent) {
        fs.writeFileSync(dst, srcContent);
        console.log(`  skill updated: ${path.basename(dst)}`);
      }
    };

    copyIfChanged(path.join(skillSrc, 'SKILL.md'), path.join(skillDst, 'SKILL.md'));

    // Sync all files under references
    const refsDir = path.join(skillSrc, 'references');
    if (fs.existsSync(refsDir)) {
      for (const f of fs.readdirSync(refsDir)) {
        copyIfChanged(path.join(refsDir, f), path.join(skillDst, 'references', f));
      }
    }
  } catch (err) {
    console.warn('skill sync failed:', err);
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Set up WebSocket adapter
  app.useWebSocketAdapter(new WsAdapter(app));

  // Enable CORS
  app.enableCors();

  // Register shutdown hooks
  app.enableShutdownHooks();

  /**
   * Reverse proxy: /proxy/<base64url>/**
   *
   * Loads external sites from iframes as same-origin.
   * http-proxy-middleware automatically forwards cookies/headers bidirectionally,
   * so login sessions are preserved as-is.
   *
   * Example: /proxy/aHR0cHM6Ly9leGFtcGxlLmNvbQ==/elders
   *   → proxied to https://example.com/elders
   */
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use(
    '/proxy',
    (req: ProxyRequest, _res: Response, next: NextFunction) => {
      // Extract target origin from /proxy/<base64url>/rest-of-path
      const match = req.url.match(/^\/([A-Za-z0-9_-]+={0,2})(\/.*)?$/);
      if (!match) return next();
      try {
        const targetOrigin = Buffer.from(match[1], 'base64').toString('utf-8');
        if (!/^https?:\/\//.test(targetOrigin)) return next();
        req._proxyTarget = targetOrigin;
        req.url = match[2] || '/'; // Forward only the remaining path to the target
        next();
      } catch {
        next();
      }
    },
    createProxyMiddleware({
      router: (req) => (req as ProxyRequest)._proxyTarget ?? '',
      changeOrigin: true,
      autoRewrite: true,
      cookieDomainRewrite: '', // Rewrite target domain cookies → proxy domain
      followRedirects: false, // Pass redirects through to the browser
      on: {
        proxyRes(proxyRes) {
          // Remove X-Frame-Options and CSP → allow iframe loading
          delete proxyRes.headers['x-frame-options'];
          delete proxyRes.headers['content-security-policy'];
          delete proxyRes.headers['content-security-policy-report-only'];
        },
      },
    }),
  );

  const port = parseInt(process.env.PORT || '58070', 10);
  await app.listen(port);

  // Ensure ~/.cltree directory exists
  if (!fs.existsSync(CLTREE_DIR)) {
    fs.mkdirSync(CLTREE_DIR, { recursive: true });
  }

  // Create lock file (cwd = directory where cltree was launched)
  const cwd = process.env.CLTREE_CWD || process.cwd();
  const lockData = {
    pid: process.pid,
    port,
    cwd,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2));

  // Restore previous pane state from DB (re-spawn CLI commands)
  const paneService = app.get(PaneService);
  const restored = paneService.restoreFromDb();
  if (restored > 0) {
    console.log(`Restored ${restored} previous pane(s)`);
  }

  // Auto-install skills: assets/skill/ → ~/.claude/skills/cltree/
  syncSkillFiles();

  console.log(`cltree server started: http://localhost:${port}`);
  console.log(`  cwd: ${cwd}`);

  // Clean up lock file on exit
  process.on('SIGINT', () => {
    removeLock();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    removeLock();
    process.exit(0);
  });
}

bootstrap();
