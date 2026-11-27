import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, theme, readTextFile, checking, focused } from "herdr";
import * as fs from "fs/promises";
import { header, ago } from "./lib.js";

// Plan usage as the usage-bar mod in Claude Code last read it (~/.claude/skills/usage-bar).
// That mod writes its reading to its own store file; this view only reads the file, so it needs
// no Claude credential. Several sessions share the file: the newest reading wins.
const storeDir = () => `${home().replace(/\\/g, "/")}/.claude/plugins/store`;

// The newest plan reading, and each session's context fill by Herdr terminal ("context:<terminal>").
async function readStore() {
  let snap = null;
  const contexts = {};
  for (const f of await fs.readdir(storeDir())) {
    if (!f.startsWith("usage-bar_") || !f.endsWith(".json")) continue;
    try {
      const store = JSON.parse(await readTextFile(`${storeDir()}/${f}`)) ?? {};
      const s = store.snapshot;
      if (s && (!snap || (s.at ?? 0) > (snap.at ?? 0))) snap = s;
      for (const [key, value] of Object.entries(store)) {
        if (!key.startsWith("context:")) continue;
        const terminal = key.slice("context:".length);
        if (!contexts[terminal] || (value?.at ?? 0) > (contexts[terminal].at ?? 0)) contexts[terminal] = value;
      }
    } catch {}
  }
  return { snap, contexts };
}

// "62k", "1.2M".
function tokens(n) {
  if (n >= 1e6) return `${Math.round(n / 1e5) / 10}M`;
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

// "2h 14m", "3d 4h", "12m", or "" when unknown or past.
function resetsIn(at, now) {
  const ms = Date.parse(at ?? "") - now;
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const minutes = Math.round(ms / 60000);
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const left = (used) => Math.max(0, Math.round((100 - used) * 10) / 10);

export const usage = {
  init(v, cx) {
    v.snap = undefined;
    v.contexts = {};
    v.error = false;
    v.shown = "";
    if (checking()) return;
    const load = async () => {
      try { ({ snap: v.snap, contexts: v.contexts } = await readStore()); v.error = false; } catch { v.error = true; }
      // Redraw on a new reading, and once a minute for the reset countdowns and age.
      const shown = JSON.stringify([v.snap, v.contexts, v.error, Math.floor(Date.now() / 60000)]);
      if (shown !== v.shown) { v.shown = shown; cx.notify(); }
    };
    cx.spawn(() => load());
    cx.timer.every(5000, (cx) => { cx.spawn(() => load()); });
  },

  render(v) {
    const t = theme();
    const s = v.snap;
    const now = Date.now();
    const colorFor = (used) => used >= 80 ? (t.ansi1 ?? t.blocked) : used >= 50 ? (t.ansi3 ?? t.blocked) : (t.ansi2 ?? t.working);

    const bar = (label, used, reset, right) => {
      const pct = Math.min(100, Math.max(0, used));
      return v_flex().gap(3).flex_none()
        .child(h_flex().gap(8).items_center()
          .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child(label))
          .child(div().flex_none().text_size(12).text_color(colorFor(used)).child(`${left(used)}% left`))
          .child(div().flex_1())
          .child(div().flex_none().text_size(11).text_color(t.dim).child(right ?? (reset ? `resets in ${reset}` : ""))))
        .child(h_flex().w_full().h(4).rounded(2).bg(t.raised).overflow_hidden()
          .child(div().h_full().w(`${pct}%`).rounded(2).bg(colorFor(used))));
    };

    const rows = [];
    if (s) {
      // No model row: the model is per session, and the file holds only the last writer's.
      // Each chat's own status line shows its model.
      const week = (s.windows ?? []).find((w) => w.kind === "seven_day");
      const session = (s.windows ?? []).find((w) => w.kind === "five_hour");
      if (session) rows.push(bar("Session", session.percentUsed, resetsIn(session.resetsAt, now)));
      if (week) rows.push(bar("Week", week.percentUsed, resetsIn(week.resetsAt, now)));
      if (s.fable) rows.push(bar(s.fable.name ?? "Fable", s.fable.percentUsed, resetsIn(s.fable.resetsAt, now)));
    }

    // The chat's agent: how full its context is, against where auto-compaction starts (the whole
    // window when compaction is off).
    const agent = focused()?.agent;
    const ctx = agent ? v.contexts[agent] : null;
    const room = ctx ? (ctx.compactAt || ctx.window) : 0;
    if (ctx && room && typeof ctx.tokens === "number") {
      const until = ctx.compactAt ? "compaction" : "the window is full";
      rows.push(bar("Context", (ctx.tokens / room) * 100, "", `${tokens(Math.max(0, room - ctx.tokens))} until ${until}`));
    } else if (agent) {
      const why = ctx ? "Compacted. It fills again with the next reply." : "No reading for this agent yet.";
      rows.push(h_flex().gap(8).items_center().flex_none()
        .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child("Context"))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(why)));
    }
    const note = v.error ? "Usage can't be read."
      : v.snap === undefined ? "Loading usage"
      : "No reading yet. It appears after the next Claude Code prompt.";

    return v_flex().size_full().bg(t.chrome)
      .child(header(t, "Usage", null, s?.at ? div().text_size(11).text_color(t.dim).child(`${ago(now - s.at)} ago`) : null))
      .child(v_flex().id("usage-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(14).pb(12).gap(10)
        .children(rows.length && !v.error ? rows : [div().w_full().whitespace_normal().text_size(12).text_color(t.dim).child(note)]));
  },
};
