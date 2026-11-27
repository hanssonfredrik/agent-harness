import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, theme, readTextFile, checking } from "herdr";
import * as fs from "fs/promises";
import { header, ago } from "./lib.js";

// Plan usage as the usage-bar mod in Claude Code last read it (~/.claude/skills/usage-bar).
// That mod writes its reading to its own store file; this view only reads the file, so it needs
// no Claude credential. Several sessions share the file: the newest reading wins.
const storeDir = () => `${home().replace(/\\/g, "/")}/.claude/plugins/store`;

async function readSnapshot() {
  let best = null;
  for (const f of await fs.readdir(storeDir())) {
    if (!f.startsWith("usage-bar_") || !f.endsWith(".json")) continue;
    try {
      const s = JSON.parse(await readTextFile(`${storeDir()}/${f}`))?.snapshot;
      if (s && (!best || (s.at ?? 0) > (best.at ?? 0))) best = s;
    } catch {}
  }
  return best;
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
    v.error = false;
    v.shown = "";
    if (checking()) return;
    const load = async () => {
      try { v.snap = await readSnapshot(); v.error = false; } catch { v.error = true; }
      // Redraw on a new reading, and once a minute for the reset countdowns and age.
      const shown = JSON.stringify([v.snap, v.error, Math.floor(Date.now() / 60000)]);
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

    const bar = (label, used, reset) => {
      const pct = Math.min(100, Math.max(0, used));
      return v_flex().gap(3).flex_none()
        .child(h_flex().gap(8).items_center()
          .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child(label))
          .child(div().flex_none().text_size(12).text_color(colorFor(used)).child(`${left(used)}% left`))
          .child(div().flex_1())
          .child(div().flex_none().text_size(11).text_color(t.dim).child(reset ? `resets in ${reset}` : "")))
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
    const note = v.error ? "Usage can't be read."
      : v.snap === undefined ? "Loading usage"
      : "No reading yet. It appears after the next Claude Code prompt.";

    return v_flex().size_full().bg(t.chrome)
      .child(header(t, "Usage", null, s?.at ? div().text_size(11).text_color(t.dim).child(`${ago(now - s.at)} ago`) : null))
      .child(v_flex().id("usage-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(14).pb(12).gap(10)
        .children(rows.length && !v.error ? rows : [div().w_full().whitespace_normal().text_size(12).text_color(t.dim).child(note)]));
  },
};
