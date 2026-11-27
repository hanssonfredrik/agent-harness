import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme, terminals, focused, shared } from "herdr";
import { followState, issuesOf, isOurs, statusOf, summaryOf, pill, header } from "./lib.js";

export const now = {
  init(v, cx) { followState(v, cx); },

  render(v) {
    const t = theme();
    const address = focused()?.agent;
    const term = address ? terminals().find((x) => x.address === address) : null;
    const mine = Boolean(term) && isOurs(term);
    const issues = term ? issuesOf(term) : [];
    const sum = mine ? summaryOf(term, v.states) : null;
    const title = issues.length === 1 ? (shared("board.titles") ?? {})[issues[0]] : null;

    const line = (label, text, color) => v_flex().gap(2).flex_none()
      .child(div().text_size(11).font_semibold().text_color(color).child(label))
      .child(div().w_full().whitespace_normal().text_size(13).line_height(1.4).text_color(t.foreground).child(text || "Nothing reported yet."));
    const note = (text) => div().w_full().whitespace_normal().text_size(12).line_height(1.4).text_color(t.muted).child(text);

    const body = !term ? note("No agent selected.")
      : !sum ? v_flex().gap(6)
        .child(div().w_full().whitespace_normal().text_size(13).text_color(t.foreground).child(term.title || "Agent"))
        .child(note(mine ? "The summary appears after the agent's first reply." : "This agent wasn't started from the board, so it has no summary."))
      : v_flex().gap(12)
        .child(line("Did", sum.did, t.muted))
        .child(line("Doing now", sum.doing, t.working))
        .child(line("Proposed next", sum.next, t.accent));

    return v_flex().size_full().bg(t.chrome)
      .child(header(t, issues.length ? issues.map((n) => `#${n}`).join(" ") : "Agent", null, mine ? pill(statusOf(term, v.states)) : null))
      .child(v_flex().id("now-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(14).pb(12).gap(10)
        .when(Boolean(title), (el) => el.child(div().w_full().flex_none().truncate().text_size(12).text_color(t.muted).child(title)))
        .child(body));
  },
};
