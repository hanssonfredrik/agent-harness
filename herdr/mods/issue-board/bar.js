import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, agents, terminals, focused, run, shared, setShared, window as win, props, notify } from "herdr";
import { followState, isOurs, issuesOf, statusOf, spinner, icon, ago } from "./lib.js";
import { launch } from "./launch.js";

const stop = (_e, cx) => cx.stop_propagation();

function newChat(v, cx) {
  if (v.starting) return;
  v.starting = true;
  const p = props();
  cx.spawn(async (cx) => {
    try {
      setShared("natsumi.focus", await launch(p, [], null));
    } catch (e) {
      notify({ title: "Couldn't start the chat", body: String(e?.message ?? e).slice(0, 200), level: "error" });
    }
    await cx.sleep(2000);
    v.starting = false;
  });
}

export const bar = {
  init(v, cx) {
    followState(v, cx);
    cx.timer.every(15000, (cx) => cx.notify());
  },

  render(v) {
    const t = theme();
    const w = win() ?? {};
    const shown = focused()?.agent;
    const up = shared("natsumi.updated");
    const terms = new Map(terminals().map((x) => [x.address, x]));

    const chip = (a) => {
      const term = terms.get(a.address);
      const mine = Boolean(term) && isOurs(term);
      const issues = mine ? issuesOf(term) : [];
      const st = mine ? statusOf(term, v.states) : { color: t[a.status] ?? t.dim, spin: a.status === "working" };
      const on = a.address === shown;
      return h_flex().id(`chip-${a.address}`).h(28).px(10).gap(7).flex_none().max_w(220).items_center().rounded(8).cursor_pointer()
        .bg(on ? t.selected : t.chrome).text_size(12).text_color(on ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click(() => run("agent.focus", { terminal: a.address }))
        .child(st.spin ? spinner(12, st.color) : div().size(7).flex_none().rounded(4).bg(st.color))
        .child(div().min_w(0).truncate().child(issues.length ? issues.map((n) => `#${n}`).join(" ") : a.title || a.space_name))
        .when(st.key === "need", (el) => el.child(div().flex_none().text_size(11).font_semibold().text_color(st.color).child("Need answer")));
    };

    const button = (id, child, on) => h_flex().id(id).h(28).px(9).flex_none().items_center().justify_center().rounded(7).cursor_pointer()
      .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover))
      .on_mouse_down("left", stop).on_click(on).child(child);
    const labelled = (name, text, color) => h_flex().gap(6).items_center().child(icon(name, 13, color)).child(text);

    return h_flex().size_full().px(12).gap(6).items_center().bg(t.chrome)
      .child(div().pr(8).flex_none().text_size(14).font_semibold().text_color(t.foreground).child(props()?.title ?? "Board"))
      .child(h_flex().id("chips").flex_1().min_w(0).gap(4).items_center().overflow_x_scrollbar().children(agents().map(chip)))
      .child(button("new-chat", labelled("plus", "New chat", t.muted), (_e, cx) => newChat(v, cx)))
      .child(button("refresh", labelled("refresh", up ? (up.ok ? `${ago(Date.now() - up.at)} ago` : "Failed") : "Refresh", up && !up.ok ? t.blocked : t.muted),
        () => setShared("natsumi.refresh", Date.now())))
      .child(button("to-main", "Main layout", () => run("layout.switch", { name: "main" })))
      .when(Boolean(w.buttons), (el) => el
        .child(button("w-min", icon("win-min", 16, t.muted), () => run("window.minimize")))
        .child(button("w-max", icon(w.maximized ? "win-restore" : "win-max", 16, t.muted), () => run("window.maximize")))
        .child(button("w-close", icon("win-close", 16, t.muted), () => run("window.close"))));
  },
};
