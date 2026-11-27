// Prints the sub-agents running now in Claude sessions under a folder, as JSON. Usage: node subagents.mjs <folder>
// Reads Claude's own files: sessions/<pid>.json (one per live session) and, per session,
// projects/*/<session>/subagents/**/agent-<id>.meta.json, which gets `finished: true` when the agent ends.
// The hook state isn't used: background sessions run outside the terminal, so they never write it.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// An agent that was killed may never be marked finished: drop it after this long without output.
const QUIET_MS = 30 * 60_000;

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const read = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const list = (dir, opts) => { try { return readdirSync(dir, opts); } catch { return []; } };
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

export function running(folder, { claude = join(homedir(), '.claude'), now = Date.now(), alive = pidAlive } = {}) {
  const root = norm(folder);
  const projects = list(join(claude, 'projects'));
  const out = [];
  for (const f of list(join(claude, 'sessions'))) {
    if (!/^\d+\.json$/.test(f)) continue;
    const s = read(join(claude, 'sessions', f));
    const cwd = norm(s?.cwd);
    if (!s?.sessionId || (cwd !== root && !cwd.startsWith(`${root}/`)) || !alive(s.pid)) continue;
    // A worktree session's files can be under another project folder than its cwd's, so look by session id.
    for (const p of projects) {
      const dir = join(claude, 'projects', p, s.sessionId, 'subagents');
      if (!existsSync(dir)) continue;
      for (const name of list(dir, { recursive: true })) {
        const id = /(?:^|[\\/])agent-([^\\/]+)\.meta\.json$/.exec(name)?.[1];
        if (!id) continue;
        const file = join(dir, name);
        const meta = read(file);
        if (!meta || meta.finished) continue;
        try {
          const log = statSync(file.replace(/\.meta\.json$/, '.jsonl'));
          // Started before this process: it ended with the earlier one.
          if (log.birthtimeMs < s.startedAt - 5000 && log.mtimeMs < s.startedAt) continue;
          if (now - log.mtimeMs > QUIET_MS) continue;
          out.push({ id, type: meta.agentType ?? 'agent', description: meta.description ?? '', session: s.name ?? s.sessionId.slice(0, 8), started: Math.round(log.birthtimeMs) });
        } catch {}
      }
    }
  }
  const seen = new Set();
  return out.filter((a) => !seen.has(a.id) && seen.add(a.id))
    .sort((a, b) => a.session.localeCompare(b.session) || a.started - b.started);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.stdout.write(JSON.stringify(running(process.argv[2])));
