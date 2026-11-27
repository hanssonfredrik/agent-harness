import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, props, theme, shared, checking } from "herdr";
import { header, icon, spinner, ago, ghError } from "./lib.js";

async function api(path) {
  const r = await exec("gh", ["api", path]);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
}

const open = (r) => r.status !== "completed";
const FAILED = ["failure", "timed_out", "startup_failure", "action_required"];
const WORDS = { success: "Passed", cancelled: "Cancelled", skipped: "Skipped", neutral: "Neutral" };

export const actions = {
  init(v, cx) {
    v.runs = null;
    v.error = null;
    v.progress = {};
    v.next = 0;
    v.seen = shared("natsumi.refresh");
    if (checking()) return;
    const load = async (cx) => {
      if (v.loading) return;
      v.loading = true;
      try {
        const repo = props().repo;
        const runs = (await api(`repos/${repo}/actions/runs?per_page=10`)).workflow_runs;
        const progress = {};
        for (const r of runs.filter((r) => r.status === "in_progress")) {
          try {
            const jobs = (await api(`repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`)).jobs;
            const steps = jobs.flatMap((j) => (j.steps?.length ? j.steps : [{ status: j.status }]));
            progress[r.id] = {
              done: steps.filter((s) => s.status === "completed").length,
              total: steps.length,
              job: jobs.find((j) => j.status === "in_progress")?.name ?? null,
            };
          } catch {
            progress[r.id] = v.progress[r.id];
          }
        }
        v.runs = runs;
        v.progress = progress;
        v.error = null;
      } catch (e) {
        v.error = ghError(e);
      }
      v.loading = false;
      v.next = Date.now() + (v.runs?.some(open) ? 15000 : 60000);
      cx.notify();
    };
    cx.spawn((cx) => load(cx));
    cx.timer.every(2000, (cx) => {
      const asked = shared("natsumi.refresh");
      const now = asked !== v.seen;
      v.seen = asked;
      if (now || Date.now() >= v.next) cx.spawn((cx) => load(cx));
    });
  },

  render(v) {
    const t = theme();
    const row = (r) => {
      const live = r.status === "in_progress";
      const wait = open(r) && !live;
      const ok = r.conclusion === "success";
      const bad = FAILED.includes(r.conclusion);
      const color = live ? t.working : ok ? t.ansi2 : bad ? t.ansi1 : t.muted;
      const p = v.progress[r.id];
      const word = live ? (p?.total ? `${p.done}/${p.total} steps` : "Running") : wait ? "Queued" : bad ? "Failed" : WORDS[r.conclusion] ?? r.conclusion ?? "";
      const took = ago(Date.parse(r.updated_at) - Date.parse(r.run_started_at));
      const when = open(r) ? ago(Date.now() - Date.parse(r.run_started_at)) : `${took} · ${ago(Date.now() - Date.parse(r.updated_at))} ago`;
      return h_flex().id(`run-${r.id}`).mx(8).px(8).py(8).gap(10).flex_none().items_start().rounded(8).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => cx.open_url(r.html_url))
        .child(div().pt(2).child(live ? spinner(14, color) : icon(wait ? "clock" : ok ? "check" : bad ? "x" : "minus", 14, color)))
        .child(v_flex().flex_1().min_w(0).gap(3)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.foreground).child(r.name ?? "Workflow"))
            .child(div().flex_none().text_size(11).font_semibold().text_color(color).child(word)))
          .child(div().w_full().truncate().text_size(11.5).text_color(t.muted).child(r.display_title ?? ""))
          .child(h_flex().gap(8).text_size(11).text_color(t.dim)
            .child(div().flex_1().min_w(0).truncate().child(p?.job ? `${r.head_branch} · ${p.job}` : r.head_branch ?? ""))
            .child(div().flex_none().child(when)))
          .when(live && Boolean(p?.total), (el) => el.child(h_flex().w_full().h(4).mt(2).gap(0).rounded(2).bg(t.raised).overflow_hidden()
            .child(div().h_full().w(Math.round((p.done / p.total) * 270)).rounded(2).bg(t.working)))));
    };
    return v_flex().size_full().bg(t.chrome)
      .child(header(t, "Actions", null, v.runs ? div().text_size(11).text_color(t.dim).child(`Latest ${v.runs.length}`) : null))
      .when(Boolean(v.error), (el) => el.child(div().mx(10).mb(8).p(10).flex_none().rounded(8).bg(t.blocked + "1e").whitespace_normal().text_size(12).text_color(t.blocked)
        .child(v.runs ? `${v.error} Showing the last known runs.` : v.error)))
      .child(v.runs
        ? v_flex().id("runs-scroll").flex_1().min_h(0).overflow_y_scrollbar()
          .children(v.runs.length ? v.runs.map(row) : [div().px(14).text_size(12).text_color(t.dim).child("No runs yet.")])
        : h_flex().flex_1().items_center().justify_center().gap(8).text_size(12).text_color(t.muted)
          .when(!v.error, (el) => el.child(spinner(13, t.muted)).child("Loading runs")));
  },
};
