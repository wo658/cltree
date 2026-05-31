import { PaneService } from '../src/server/pane/pane.service';

/**
 * Tests for agent-tool detection, system-prompt injection, and resume command
 * assembly.
 *
 * These three methods don't rely on DI dependencies, so we can call them on a
 * bare PaneService instance.
 * `findLatestConversationId` touches the filesystem; we override the prototype
 * to keep the tests isolated.
 */

function createService(): PaneService {
  // PaneService's constructor takes a lot of DI args, but the helpers we test
  // don't depend on instance fields (except that the Claude branch of
  // applyResume calls findLatestConversationId). So we leave the methods on
  // the prototype and use a bare-bones instance.
  const svc = Object.create(PaneService.prototype) as PaneService;
  return svc;
}

describe('PaneService.detectAgentTool', () => {
  const svc = createService();

  test('detects the claude binary', () => {
    expect(svc.detectAgentTool('claude --foo')).toBe('claude');
  });

  test('detects the claude- prefix (e.g. claude-code)', () => {
    expect(svc.detectAgentTool('claude-code --bar')).toBe('claude');
  });

  test('detects the codex binary', () => {
    expect(svc.detectAgentTool('codex --full-auto')).toBe('codex');
  });

  test('detects the gemini binary', () => {
    expect(svc.detectAgentTool('gemini --yolo')).toBe('gemini');
  });

  test('absolute path — uses the trailing path component', () => {
    expect(svc.detectAgentTool('/opt/homebrew/bin/gemini -y')).toBe('gemini');
    expect(svc.detectAgentTool('/usr/local/bin/codex')).toBe('codex');
    expect(svc.detectAgentTool('/Users/me/.local/bin/claude --foo')).toBe('claude');
  });

  test('unknown CLI falls back to generic', () => {
    expect(svc.detectAgentTool('ollama run llama3')).toBe('generic');
    expect(svc.detectAgentTool('python agent.py')).toBe('generic');
  });

  test('empty string is generic', () => {
    expect(svc.detectAgentTool('')).toBe('generic');
    expect(svc.detectAgentTool('   ')).toBe('generic');
  });

  test('lookalike names like codeximposter stay generic (exact match)', () => {
    expect(svc.detectAgentTool('codeximposter')).toBe('generic');
    expect(svc.detectAgentTool('mycodex')).toBe('generic');
  });
});

describe('PaneService.applySystemPrompt', () => {
  const svc = createService();

  test('claude — uses --append-system-prompt', () => {
    const out = svc.applySystemPrompt('claude', 'claude --foo', 'CLTREE_AGENT_PROMPT');
    expect(out).toBe('claude --foo --append-system-prompt "$CLTREE_AGENT_PROMPT"');
  });

  test('codex — positional', () => {
    const out = svc.applySystemPrompt('codex', 'codex --full-auto', 'CLTREE_AGENT_PROMPT');
    expect(out).toBe('codex --full-auto "$CLTREE_AGENT_PROMPT"');
  });

  test('gemini — uses -i', () => {
    const out = svc.applySystemPrompt('gemini', 'gemini --yolo', 'CLTREE_AGENT_PROMPT');
    expect(out).toBe('gemini --yolo -i "$CLTREE_AGENT_PROMPT"');
  });

  test('generic — unchanged', () => {
    const out = svc.applySystemPrompt('generic', 'ollama run llama3', 'CLTREE_AGENT_PROMPT');
    expect(out).toBe('ollama run llama3');
  });

  test('env var name can be customized via arg', () => {
    const out = svc.applySystemPrompt('claude', 'claude', 'OTHER_VAR');
    expect(out).toBe('claude --append-system-prompt "$OTHER_VAR"');
  });
});

describe('PaneService.applyResume', () => {
  const svc = createService();

  test('claude — uses the stored ID', () => {
    const out = svc.applyResume('claude', 'claude --foo', 'conv-abc-123', '/tmp/x');
    expect(out).toBe('claude --resume conv-abc-123 --foo');
  });

  test('claude — without an ID, tries findLatestConversationId; returns null if none', () => {
    // Override the prototype method.
    const orig = (PaneService.prototype as unknown as { findLatestConversationId: (cwd: string) => string | null }).findLatestConversationId;
    (PaneService.prototype as unknown as { findLatestConversationId: (cwd: string) => string | null }).findLatestConversationId = () => null;
    try {
      const out = svc.applyResume('claude', 'claude --foo', null, '/tmp/x');
      expect(out).toBeNull();
    } finally {
      (PaneService.prototype as unknown as { findLatestConversationId: (cwd: string) => string | null }).findLatestConversationId = orig;
    }
  });

  test('claude — fallback uses the path-search result', () => {
    const orig = (PaneService.prototype as unknown as { findLatestConversationId: (cwd: string) => string | null }).findLatestConversationId;
    (PaneService.prototype as unknown as { findLatestConversationId: (cwd: string) => string | null }).findLatestConversationId = () => 'found-id';
    try {
      const out = svc.applyResume('claude', 'claude --foo', null, '/tmp/x');
      expect(out).toBe('claude --resume found-id --foo');
    } finally {
      (PaneService.prototype as unknown as { findLatestConversationId: (cwd: string) => string | null }).findLatestConversationId = orig;
    }
  });

  test('codex — always inserts the resume --last subcommand', () => {
    const out = svc.applyResume('codex', 'codex --full-auto', null, '/tmp/x');
    expect(out).toBe('codex resume --last --full-auto');
  });

  test('codex — ignores the stored ID and uses --last (codex does not support cwd-keyed tracking)', () => {
    const out = svc.applyResume('codex', 'codex', 'some-id', '/tmp/x');
    expect(out).toBe('codex resume --last');
  });

  test('gemini — adds --resume latest', () => {
    const out = svc.applyResume('gemini', 'gemini --yolo', null, '/tmp/x');
    expect(out).toBe('gemini --resume latest --yolo');
  });

  test('gemini — no-op when --resume is already present', () => {
    const out = svc.applyResume('gemini', 'gemini --resume 3 --yolo', null, '/tmp/x');
    expect(out).toBe('gemini --resume 3 --yolo');
    const out2 = svc.applyResume('gemini', 'gemini --resume=latest', null, '/tmp/x');
    expect(out2).toBe('gemini --resume=latest');
  });

  test('generic — always null (resume unsupported)', () => {
    const out = svc.applyResume('generic', 'ollama run llama3', 'whatever', '/tmp/x');
    expect(out).toBeNull();
  });

  test('absolute-path binary is preserved', () => {
    const out = svc.applyResume('codex', '/opt/homebrew/bin/codex --full-auto', null, '/tmp/x');
    expect(out).toBe('/opt/homebrew/bin/codex resume --last --full-auto');
  });
});
