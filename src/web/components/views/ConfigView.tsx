import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { apiClient } from '@web/lib/api-client';
import { Bot, Terminal, Globe, FolderGit, Monitor, MapPin, Settings } from 'lucide-react';

/**
 * Config View.
 * Visualizes project/global settings + agent configuration + environment info.
 */

interface ConfigInfo {
  config: Record<string, unknown>;
  env: { nodeVersion: string; shell: string; cwd: string; platform: string };
  paths: { globalConfig: string; projectConfig: string; db: string; lock: string };
}

export function ConfigView() {
  const [info, setInfo] = useState<ConfigInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.cli<ConfigInfo>(['cfg', 'info']);
      if (res.ok) setInfo(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const handleSave = async (key: string) => {
    await apiClient.cli(['cfg', 'set', key, editValue]);
    setEditingKey(null);
    fetchConfig();
  };

  if (loading && !info) {
    return <div className="flex items-center justify-center h-full text-zinc-500 text-sm">Loading…</div>;
  }
  if (!info) return null;

  const agentConfig = (info.config.agent || {}) as Record<string, unknown>;
  const termConfig = (info.config.terminal || {}) as Record<string, unknown>;
  const webConfig = (info.config.web || {}) as Record<string, unknown>;
  const sessionConfig = (info.config.session || {}) as Record<string, unknown>;
  const worktreeConfig = (info.config.worktree || {}) as Record<string, unknown>;

  return (
    <div className="flex h-full flex-col bg-zinc-950 overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2.5 bg-zinc-900/60 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-zinc-400" />
          <span className="text-sm font-medium text-zinc-200">Settings</span>
        </div>
        <button
          onClick={fetchConfig}
          className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          ↻
        </button>
      </div>

      <div className="p-4 space-y-5">
        {/* Agent settings */}
        <ConfigSection title="Agent" icon={<Bot className="w-3.5 h-3.5 text-zinc-500" />}>
          <ConfigRow label="CLI" configKey="agent.cli" value={agentConfig.cli as string} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
          <ConfigRow label="Flags" configKey="agent.flags" value={JSON.stringify(agentConfig.flags)} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
          <ConfigRow label="Model" configKey="agent.model" value={(agentConfig.model as string) || '(default)'} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
          <ConfigRow label="Resume on restart" configKey="agent.resumeOnRestart" value={String(agentConfig.resumeOnRestart ?? true)} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
          <ConfigRow label="Inject system prompt" configKey="agent.injectSystemPrompt" value={String(agentConfig.injectSystemPrompt ?? true)} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
        </ConfigSection>

        {/* Terminal settings */}
        <ConfigSection title="Terminal" icon={<Terminal className="w-3.5 h-3.5 text-zinc-500" />}>
          <ConfigRow label="Shell" configKey="terminal.shell" value={(termConfig.shell as string) || '$SHELL'} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
          <ConfigRow label="TERM" configKey="terminal.term" value={termConfig.term as string} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
          <ConfigRow label="Scrollback" configKey="terminal.scrollback" value={String(termConfig.scrollback)} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
        </ConfigSection>

        {/* Web / xterm settings */}
        <ConfigSection title="Web / xterm" icon={<Globe className="w-3.5 h-3.5 text-zinc-500" />}>
          {Object.entries((webConfig.xterm as Record<string, unknown>) || {}).map(([k, v]) => (
            <ConfigRow key={k} label={k} configKey={`web.xterm.${k}`} value={String(v)} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
          ))}
        </ConfigSection>

        {/* Session / Worktree settings */}
        <ConfigSection title="Session / Worktree" icon={<FolderGit className="w-3.5 h-3.5 text-zinc-500" />}>
          <ConfigRow label="On exit" configKey="session.onExit" value={sessionConfig.onExit as string} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
          <ConfigRow label="Symlinks" configKey="worktree.symlinks" value={JSON.stringify(worktreeConfig.symlinks)} onEdit={setEditingKey} editingKey={editingKey} editValue={editValue} setEditValue={setEditValue} onSave={handleSave} />
        </ConfigSection>

        {/* Environment info (read-only) */}
        <ConfigSection title="Environment" icon={<Monitor className="w-3.5 h-3.5 text-zinc-500" />}>
          <InfoRow label="Node" value={info.env.nodeVersion} />
          <InfoRow label="Shell" value={info.env.shell} />
          <InfoRow label="CWD" value={info.env.cwd} />
          <InfoRow label="Platform" value={info.env.platform} />
        </ConfigSection>

        {/* Paths (read-only) */}
        <ConfigSection title="Paths" icon={<MapPin className="w-3.5 h-3.5 text-zinc-500" />}>
          <InfoRow label="Global config" value={info.paths.globalConfig} />
          <InfoRow label="Project config" value={info.paths.projectConfig} />
          <InfoRow label="Database" value={info.paths.db} />
          <InfoRow label="Lock file" value={info.paths.lock} />
        </ConfigSection>
      </div>
    </div>
  );
}

function ConfigSection({ title, icon, children }: { title: string; icon: ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</span>
      </div>
      <div className="rounded-lg border border-zinc-800/80 divide-y divide-zinc-800/50 bg-zinc-900/30">
        {children}
      </div>
    </div>
  );
}

function ConfigRow({ label, configKey, value, onEdit, editingKey, editValue, setEditValue, onSave }: {
  label: string;
  configKey: string;
  value: string;
  onEdit: (key: string | null) => void;
  editingKey: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  onSave: (key: string) => void;
}) {
  const isEditing = editingKey === configKey;

  return (
    <div className="flex items-center justify-between px-3 py-2 group">
      <span className="text-xs text-zinc-400 font-mono w-40 flex-shrink-0">{label}</span>
      {isEditing ? (
        <div className="flex items-center gap-1 flex-1 ml-2">
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            autoFocus
            className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-100 outline-none focus:border-zinc-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(configKey);
              if (e.key === 'Escape') onEdit(null);
            }}
          />
          <button onClick={() => onSave(configKey)} className="text-green-500 text-xs px-1">✓</button>
          <button onClick={() => onEdit(null)} className="text-zinc-500 text-xs px-1">✕</button>
        </div>
      ) : (
        <div className="flex items-center gap-1 flex-1 ml-2">
          <span className="text-xs text-zinc-300 font-mono truncate flex-1">{value}</span>
          <button
            onClick={() => { onEdit(configKey); setEditValue(value === '(default)' ? '' : value); }}
            className="text-zinc-600 hover:text-zinc-300 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          >
            edit
          </button>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-zinc-400 font-mono w-40 flex-shrink-0">{label}</span>
      <span className="text-xs text-zinc-500 font-mono truncate flex-1 ml-2">{value}</span>
    </div>
  );
}
