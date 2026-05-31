/**
 * Browse reverse proxy unit tests.
 *
 * Validates URL routing, header handling, and cookie forwarding
 * for the http-proxy-middleware-based proxy.
 *
 * Spins up a local target server and an express + proxy middleware
 * stack directly, so tests run independently from the main server.
 */
import * as http from 'http';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

/* ── test target server ── */

function createTargetServer(): http.Server {
  const app = express();
  app.use(express.urlencoded({ extended: true }));

  app.get('/', (req, res) => {
    if (req.headers.cookie?.includes('session=')) {
      res.send('Welcome, user!');
    } else {
      res.send('Please login');
    }
  });

  app.post('/login', (_req, res) => {
    res.setHeader('Set-Cookie', 'session=abc123; Path=/; HttpOnly');
    res.redirect(302, '/');
  });

  app.get('/api/me', (req, res) => {
    if (req.headers.cookie?.includes('session=')) {
      res.json({ user: 'testuser' });
    } else {
      res.status(401).json({ error: 'unauthorized' });
    }
  });

  app.get('/style.css', (_req, res) => {
    res.type('text/css').send('body { color: red; }');
  });

  // For testing X-Frame-Options header stripping
  app.get('/framed', (_req, res) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.send('framed page');
  });

  return http.createServer(app);
}

/* ── test proxy server (mirrors main.ts logic) ── */

function createProxyServer(targetPort: number): http.Server {
  const app = express();

  app.use(
    '/proxy',
    (req: any, _res: any, next: any) => {
      const match = req.url.match(/^\/([A-Za-z0-9_\-+/]+={0,2})(\/.*)?$/);
      if (!match) return next();
      try {
        const targetOrigin = Buffer.from(match[1], 'base64').toString('utf-8');
        if (!/^https?:\/\//.test(targetOrigin)) return next();
        req._proxyTarget = targetOrigin;
        req.url = match[2] || '/';
        next();
      } catch {
        next();
      }
    },
    createProxyMiddleware({
      router: (req: any) => req._proxyTarget,
      changeOrigin: true,
      autoRewrite: true,
      cookieDomainRewrite: '',
      followRedirects: false,
      on: {
        proxyRes(proxyRes) {
          delete proxyRes.headers['x-frame-options'];
          delete proxyRes.headers['content-security-policy'];
          delete proxyRes.headers['content-security-policy-report-only'];
        },
      },
    }),
  );

  return http.createServer(app);
}

/* ── helpers ── */

function request(
  url: string,
  opts: { method?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: opts.method || 'GET',
        headers: opts.headers || {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function toProxyUrl(proxyPort: number, targetPort: number, path: string): string {
  const originB64 = Buffer.from(`http://localhost:${targetPort}`).toString('base64');
  return `http://localhost:${proxyPort}/proxy/${originB64}${path}`;
}

/* ── tests ── */

const TARGET_PORT = 19876;
const PROXY_PORT = 19877;
let targetServer: http.Server;
let proxyServer: http.Server;

beforeAll(async () => {
  targetServer = createTargetServer();
  proxyServer = createProxyServer(TARGET_PORT);
  await new Promise<void>((r) => targetServer.listen(TARGET_PORT, r));
  await new Promise<void>((r) => proxyServer.listen(PROXY_PORT, r));
});

afterAll(() => {
  targetServer.close();
  proxyServer.close();
});

describe('http-proxy-middleware reverse proxy', () => {
  test('basic GET proxying', async () => {
    const res = await request(toProxyUrl(PROXY_PORT, TARGET_PORT, '/'));
    expect(res.status).toBe(200);
    expect(res.body).toContain('Please login');
  });

  test('proxies static resources', async () => {
    const res = await request(toProxyUrl(PROXY_PORT, TARGET_PORT, '/style.css'));
    expect(res.status).toBe(200);
    expect(res.body).toBe('body { color: red; }');
  });

  test('forwards Cookie to target and returns authenticated response', async () => {
    const res = await request(toProxyUrl(PROXY_PORT, TARGET_PORT, '/'), {
      headers: { Cookie: 'session=abc123' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('Welcome, user!');
  });

  test('returns 401 when no Cookie is sent', async () => {
    const res = await request(toProxyUrl(PROXY_PORT, TARGET_PORT, '/api/me'));
    expect(res.status).toBe(401);
  });

  test('returns 200 + JSON when Cookie is sent', async () => {
    const res = await request(toProxyUrl(PROXY_PORT, TARGET_PORT, '/api/me'), {
      headers: { Cookie: 'session=abc123' },
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ user: 'testuser' });
  });

  test('forwards Set-Cookie to client', async () => {
    const res = await request(toProxyUrl(PROXY_PORT, TARGET_PORT, '/login'), {
      method: 'POST',
    });
    // 302 redirect
    expect(res.status).toBe(302);
    // Set-Cookie is forwarded to the client
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(setCookie![0]).toContain('session=abc123');
  });

  test('strips X-Frame-Options / CSP headers', async () => {
    const res = await request(toProxyUrl(PROXY_PORT, TARGET_PORT, '/framed'));
    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  test('autoRewrite: 302 Location is rewritten relative to the proxy', async () => {
    const res = await request(toProxyUrl(PROXY_PORT, TARGET_PORT, '/login'), {
      method: 'POST',
    });
    expect(res.status).toBe(302);
    const location = res.headers['location'];
    expect(location).toBeDefined();
    // autoRewrite changes Location to the proxy host,
    // or leaves it as the relative path '/' — both are OK
    expect(location).not.toContain(`localhost:${TARGET_PORT}`);
  });
});
