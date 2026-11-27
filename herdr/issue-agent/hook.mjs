// Claude Code hook for sessions started from the issue board. Records what the session is doing in
// state/<terminal>.json, which the Herdr mods watch. It never blocks Claude: any failure exits 0.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// A short line for what a tool call is doing. Never the command or file contents.
export function activity(tool, input = {}) {
  const file = basename(String(input.file_path ?? ''));
  if (typeof input.description === 'string' && input.description) return input.description.slice(0, 90);
  if (tool === 'Read') return `Reading ${file}`;
  if (tool === 'Edit' || tool === 'Write') return `Editing ${file}`;
  if (tool === 'Grep' || tool === 'Glob') return 'Searching the code';
  if (typeof input.activeForm === 'string') return input.activeForm.slice(0, 90);
  return null;
}

export function parseSummary(text) {
  const lines = String(text ?? '').split(/\r?\n/).reverse();
  for (const line of lines) {
    const m = /Did:\s*(.*?)\s*\|\s*Doing:\s*(.*?)\s*\|\s*Next:\s*(.*)$/i.exec(line.replace(/[*`_]/g, ''));
    if (m) return { did: m[1].trim(), doing: m[2].trim(), next: m[3].trim() };
  }
  return null;
}

// A turn that ends in plain prose with a question: the last line before the summary line ends in "?".
export function endsWithQuestion(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.replace(/[*`_]/g, '').trim())
    .filter((l) => l && !/^Did:.*\|.*Doing:/i.test(l));
  return /\?$/.test(lines.at(-1) ?? '');
}

export function next(prev, e) {
  const s = { ...prev, at: Date.now(), event: e.hook_event_name, session: e.session_id ?? prev.session };
  if (e.permission_mode) s.mode = e.permission_mode;
  switch (e.hook_event_name) {
    case 'SessionStart': return { ...s, phase: 'idle', need: null };
    case 'SessionEnd': return { ...s, phase: 'ended', need: null };
    case 'UserPromptSubmit': return { ...s, phase: 'working', need: null, activity: null };
    case 'PreToolUse':
      return { ...s, phase: 'working', activity: activity(e.tool_name, e.tool_input) ?? s.activity, need: e.tool_name === 'ExitPlanMode' ? 'plan' : e.tool_name === 'AskUserQuestion' ? 'question' : null };
    case 'PostToolUse':
      if (e.tool_name === 'ExitPlanMode') s.approved = true;
      return { ...s, phase: 'working', need: null };
    case 'PostToolUseFailure': return { ...s, phase: 'working', need: null };
    case 'Notification':
      return /permission|elicitation/.test(e.notification_type ?? '') ? { ...s, need: s.need ?? 'permission' } : s;
    case 'Stop': {
      const text = e.last_assistant_message;
      return { ...s, phase: 'stopped', need: endsWithQuestion(text) ? 'question' : null, summary: parseSummary(text) ?? s.summary };
    }
    case 'StopFailure': return { ...s, phase: 'error', need: null };
    default: return s;
  }
}

function main() {
  const e = JSON.parse(readFileSync(0, 'utf8'));
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal) return;
  const dir = process.env.ISSUE_AGENT_STATE ?? join(dirname(fileURLToPath(import.meta.url)), 'state');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${terminal.replace(/[^\w-]/g, '_')}.json`);
  let prev = {};
  try { prev = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  // Terminal ids can be reused: a new session starts clean.
  if (prev.session && e.session_id && prev.session !== e.session_id) prev = {};
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next(prev, e)));
  renameSync(tmp, file);
  if (e.hook_event_name === 'PostToolUse' && e.tool_name === 'ExitPlanMode') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse',
      additionalContext: 'The plan was approved. Before anything else, move the issue cards you were given to In Progress with: {{MOVE_COMMAND}} in-progress <issue> ...' } }));
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { try { main(); } catch {} }
