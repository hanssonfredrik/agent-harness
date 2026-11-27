import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, props, theme, checking } from "herdr";
import { agentDir, header, spinner, ago } from "./lib.js";

// The sub-agents running in every Claude session of the folder, grouped by session.
export const subagents = {
  init(v, cx) {
    v.list = null;
    v.error = false;
    v.shown = "";
    if (checking()) return;
    const load = async (cx) => {
      if (v.loading) return;
      v.loading = true;
      try {
        const r = await exec("node", [`${agentDir()}/subagents.mjs`, props().folder], { timeout: 10000 });
        if (r.code !== 0) throw new Error(r.stderr);
        v.list = JSON.parse(r.stdout).map((a) => ({ ...a, age: ago(Date.now() - a.started) }));
        v.error = false;
      } catch {
        v.error = true;
      }
      v.loading = false;
      // Every redraw redraws the window: only when something shown changed.
      const shown = JSON.stringify([v.list, v.error]);
      if (shown !== v.shown) { v.shown = shown; cx.notify(); }
    };
    cx.spawn((cx) => load(cx));
    cx.timer.every(4000, (cx) => { cx.spawn((cx) => load(cx)); });
  },

  render(v) {
    const t = theme();
    const list = v.list ?? [];
    const row = (a) => h_flex().id(`sub-${a.id}`).mx(8).px(8).py(6).gap(10).flex_none().items_start()
      .child(div().pt(2).child(spinner(14, t.working)))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(8).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(a.description || a.type))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(a.age)))
        .child(div().w_full().truncate().text_size(11.5).text_color(t.muted).child(a.type)));
    const rows = [];
    let session = null;
    for (const a of list) {
      if (a.session !== session) {
        session = a.session;
        rows.push(div().px(16).pt(4).pb(2).flex_none().truncate().text_size(11).font_semibold().text_color(t.dim).child(session));
      }
      rows.push(row(a));
    }
    const note = v.error ? "Sub-agents can't be read." : v.list ? "No sub-agents running." : "Loading sub-agents";
    return v_flex().size_full().bg(t.chrome)
      .child(header(t, "Sub-agents", v.list && !v.error ? list.length : null))
      .child(v_flex().id("subagents-scroll").flex_1().min_h(0).overflow_y_scrollbar().pb(8)
        .children(rows.length && !v.error ? rows : [div().px(14).flex_none().text_size(12).text_color(t.dim).child(note)]));
  },
};
