import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals, appHome, theme, readTextFile, watchFolder, checking } from "herdr";
import * as fs from "fs/promises";

// The Herdr space board agents run in. Its id is a label on every agent's terminal, so changing
// it disconnects agents that are already running from the board.
export const SPACE = "spnatsumiboard";
export const agentDir = () => `${appHome().replace(/\\/g, "/")}/issue-agent`;

// Hook state per terminal (issue-agent/hook.mjs writes it). Each view follows the folder itself.
export function followState(view, cx) {
  view.states = {};
  if (checking()) return;
  const dir = `${agentDir()}/state`;
  const load = async () => {
    const out = {};
    for (const f of await fs.readdir(dir)) {
      if (!f.endsWith(".json")) continue;
      try { out[f.slice(0, -5)] = JSON.parse(await readTextFile(`${dir}/${f}`)); } catch {}
    }
    view.states = out;
  };
  cx.spawn(async (cx) => {
    for (;;) {
      const watch = watchFolder(dir);
      try { await load(); cx.notify(); await watch; } catch { await cx.sleep(5000); }
      await cx.sleep(150);
    }
  });
}

export const issuesOf = (t) => (t.labels?.["board.issues"] ?? "").split("-").map(Number).filter(Boolean);
export const isOurs = (t) => t.labels?.["herdr.space"] === SPACE && t.state === "live";
export const ours = () => terminals().filter(isOurs);

// What a terminal's session is doing: { key, label, color, spin }.
export function statusOf(term, states) {
  const t = theme();
  const raw = states[term.address];
  // Ignore a file left by an earlier terminal with the same address.
  const s = raw && raw.at >= (term.created_ms ?? 0) ? raw : null;
  const need = { key: "need", label: "Need answer", color: t.blocked };
  if (s?.phase === "ended") return { key: "ended", label: "Ended", color: t.dim };
  if (term.status === "blocked") return need;
  if (term.status === "error" || s?.phase === "error") return { key: "error", label: "Error", color: t.ansi1 };
  if (!term.status && !s) return { key: "working", label: "Starting", color: t.working, spin: true };
  if (term.status === "working") {
    return s?.mode === "plan"
      ? { key: "planning", label: "Planning", color: t.accent, spin: true }
      : { key: "working", label: "Working", color: t.working, spin: true };
  }
  if (s?.need) return need;
  if (!s || s.phase === "idle") return { key: "ready", label: "Ready", color: t.muted };
  return { key: "stopped", label: "Stopped", color: t.muted };
}

// Did / doing / next. While a turn runs, "doing" is live: the last tool call, or the open question.
export function summaryOf(term, states) {
  const s = states[term?.address];
  if (!s || s.at < (term.created_ms ?? 0)) return null;
  const st = statusOf(term, states);
  const doing = st.key === "need" ? "Waiting for your answer."
    : st.spin ? s.activity ?? s.summary?.doing
    : s.summary?.doing;
  if (!s.summary && !doing) return null;
  return { did: s.summary?.did, doing, next: s.summary?.next };
}

export const icon = (name, size, color) => svg(`mods/issue-board/${name}.svg`).size(size).flex_none().text_color(color);
export const spinner = (size, color) => icon("spinner", size, color).spin(900);

export function pill(st) {
  return h_flex().flex_none().h(20).px(7).gap(5).items_center().rounded(6).bg(st.color + "22")
    .text_size(11).font_semibold().text_color(st.color)
    .child(st.spin ? spinner(11, st.color) : div().size(6).rounded(3).bg(st.color))
    .child(st.label);
}

export function header(t, title, count, right) {
  return h_flex().h(40).px(14).gap(8).flex_none().items_center()
    .child(div().text_size(13).font_semibold().text_color(t.foreground).child(title))
    .when(count != null, (el) => el.child(div().px(6).rounded(5).bg(t.raised).text_size(11).text_color(t.muted).child(String(count))))
    .child(div().flex_1())
    .when(Boolean(right), (el) => el.child(right));
}

export function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}

export function ghError(e) {
  const text = String(e?.message ?? e ?? "").trim();
  if (/rate limit/i.test(text)) return "GitHub rate limit reached.";
  if (/dial tcp|lookup |error connecting|timeout|timed out|no such host/i.test(text)) return "GitHub can't be reached.";
  if (/auth login|not logged|401|bad credentials/i.test(text)) return "gh is not signed in. Run gh auth login.";
  if (/scope|could not resolve to a|not found|404/i.test(text)) return "No access. gh may be on the wrong account.";
  return text.split("\n")[0].slice(0, 140) || "GitHub request failed.";
}
