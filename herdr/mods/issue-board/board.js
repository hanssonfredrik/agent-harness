import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, props, theme, agents, spaces, run, shared, setShared, notify, checking, focused } from "herdr";
import { followState, ours, issuesOf, statusOf, pill, header, icon, spinner, ghError, SPACE } from "./lib.js";
import { launch } from "./launch.js";

const COLUMNS = ["In Progress", "Next", "Todo"];
const QUERY = `query($owner:String!,$number:Int!,$filter:String!){user(login:$owner){projectV2(number:$number){id
  field(name:"Status"){... on ProjectV2SingleSelectField{id options{id name}}}
  items(first:100,query:$filter){nodes{id fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}}
  content{... on Issue{number title url repository{nameWithOwner} labels(first:6){nodes{name color}}}}}}}}}`;

// Project, Status field and option ids, read with the board so nothing is hard-coded.
let ids = null;

async function fetchBoard(p) {
  const r = await exec("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${p.owner}`, "-F", `number=${p.project}`,
    "-f", 'filter=status:Todo,Next,"In Progress"']);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout);
  const data = JSON.parse(r.stdout);
  const project = data.data?.user?.projectV2;
  if (!project) throw new Error(data.errors?.[0]?.message ?? "not found");
  ids = { project: project.id, field: project.field?.id, options: Object.fromEntries((project.field?.options ?? []).map((o) => [o.name, o.id])) };
  return project.items.nodes
    .filter((n) => n.content?.number && n.content.repository.nameWithOwner === p.repo)
    .map((n) => ({ item: n.id, number: n.content.number, title: n.content.title, url: n.content.url, labels: n.content.labels.nodes, status: n.fieldValueByName?.name }));
}

// Sets a card's Status on the board. Only ids go into the arguments.
function move(v, i, to, cx) {
  const option = ids?.options?.[to];
  if (!option || !ids.field || v.moving.has(i.number)) return;
  const from = i.status;
  v.moving.add(i.number);
  v.picked.delete(i.number);
  i.status = to;
  cx.notify();
  cx.spawn(async (cx) => {
    const r = await exec("gh", ["project", "item-edit", "--project-id", ids.project, "--id", i.item,
      "--field-id", ids.field, "--single-select-option-id", option]);
    if (r.code !== 0) {
      i.status = from;
      notify({ title: `Couldn't move #${i.number} to ${to}`, body: ghError(r.stderr || r.stdout), level: "error" });
    }
    v.moving.delete(i.number);
    cx.notify();
  });
}

// Names the space and tabs the board made (hc can't), and shows a new agent once it reports.
function tidy() {
  const pending = shared("natsumi.focus");
  if (pending && agents().some((a) => a.address === pending)) {
    setShared("natsumi.focus", null);
    run("agent.focus", { terminal: pending });
  }
  const list = ours();
  const space = list.length ? spaces().find((s) => s.id === SPACE) : null;
  if (!space) return;
  if (!space.named) run("space.rename", { id: space.id, name: "Natsumi" });
  for (const tab of space.tabs) {
    const term = !tab.named && list.find((x) => x.labels["herdr.tab"] === tab.id);
    if (!term) continue;
    run("tab.rename", { id: tab.id, name: issuesOf(term).map((n) => `#${n}`).join(" ") || "Chat" });
  }
}

function start(v, numbers, mode, cx) {
  const busy = new Map(ours().flatMap((x) => issuesOf(x).map((n) => [n, x.address])));
  const taken = numbers.find((n) => busy.has(n));
  if (taken) { run("agent.focus", { terminal: busy.get(taken) }); return; }
  if (numbers.some((n) => v.starting.has(n))) return;
  numbers.forEach((n) => v.starting.add(n));
  const active = ours().filter((x) => x.status === "working").length;
  if (active) notify({ title: `${active + 1} agents running`, body: "Run only one heavy job at a time (database tests, emulator, build).", level: "warning" });
  cx.notify();
  const p = props();
  cx.spawn(async (cx) => {
    try {
      setShared("natsumi.focus", await launch(p, numbers, mode));
      numbers.forEach((n) => v.picked.delete(n));
    } catch (e) {
      notify({ title: "Couldn't start the agent", body: String(e?.message ?? e).slice(0, 200), level: "error" });
    }
    await cx.sleep(2500);
    numbers.forEach((n) => v.starting.delete(n));
    cx.notify();
  });
}

export const board = {
  init(v, cx) {
    v.items = null;
    v.error = null;
    v.picked = new Set();
    v.starting = new Set();
    v.moving = new Set();
    v.seen = shared("natsumi.refresh");
    followState(v, cx);
    if (checking()) return;
    const load = async (cx) => {
      if (v.loading) return;
      v.loading = true;
      try {
        const items = await fetchBoard(props());
        // A move in flight keeps its new column until gh answers.
        for (const i of items) {
          const old = v.moving.size && v.items?.find((x) => x.number === i.number);
          if (old && v.moving.has(i.number)) i.status = old.status;
        }
        v.items = items;
        v.error = null;
        const next = new Set(v.items.filter((i) => i.status === "Next").map((i) => i.number));
        v.picked = new Set([...v.picked].filter((n) => next.has(n)));
        const titles = Object.fromEntries(v.items.map((i) => [i.number, i.title]));
        if (JSON.stringify(shared("natsumi.titles")) !== JSON.stringify(titles)) setShared("natsumi.titles", titles);
      } catch (e) {
        v.error = ghError(e);
      }
      v.loading = false;
      setShared("natsumi.updated", { at: Date.now(), ok: !v.error });
      cx.notify();
    };
    cx.spawn((cx) => load(cx));
    cx.timer.every(30000, (cx) => { cx.spawn((cx) => load(cx)); });
    cx.timer.every(1000, (cx) => {
      const asked = shared("natsumi.refresh");
      if (asked !== v.seen) { v.seen = asked; cx.spawn((cx) => load(cx)); }
      tidy();
    });
  },

  render(v) {
    const t = theme();
    const byIssue = new Map(ours().flatMap((x) => issuesOf(x).map((n) => [n, x])));
    const shown = focused()?.agent;

    const btn = (id, label, primary, on) => h_flex().id(id).h(24).px(10).items_center().rounded(6).text_size(11.5).font_semibold().cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => { cx.stop_propagation(); on(cx); })
      .child(label);

    const tick = (i, picked) => h_flex().id(`pick-${i.number}`).size(16).flex_none().items_center().justify_center().rounded(4).border_1().cursor_pointer()
      .border_color(picked ? t.accent : t.input).bg(picked ? t.accent : t.surface)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        picked ? v.picked.delete(i.number) : v.picked.add(i.number);
        cx.notify();
      })
      .when(picked, (el) => el.child(icon("check", 11, t.accent_foreground)));

    const card = (i) => {
      const term = byIssue.get(i.number);
      const st = v.starting.has(i.number) ? { key: "working", label: "Starting", color: t.working, spin: true }
        : term ? statusOf(term, v.states)
        : i.status === "In Progress" ? { key: "none", label: "No agent", color: t.muted } : null;
      const on = Boolean(term) && term.address === shown;
      const canStart = i.status === "Next" && !term && !v.starting.has(i.number);
      const moving = v.moving.has(i.number);
      const canMove = (i.status === "Todo" || canStart) && !moving;
      return v_flex().id(`card-${i.number}`).mx(10).mb(8).p(11).gap(7).flex_none().rounded(10).border_1()
        .border_color(st?.key === "need" ? t.blocked : on ? t.accent : t.border)
        .bg(on ? t.selected : t.surface)
        .hover((s) => s.bg(t.hover))
        .when(Boolean(term), (el) => el.cursor_pointer().on_click(() => run("agent.focus", { terminal: term.address })))
        .child(h_flex().gap(8).items_center()
          .when(canStart, (el) => el.child(tick(i, v.picked.has(i.number))))
          .child(div().text_size(11.5).text_color(t.muted).child(`#${i.number}`))
          .child(div().flex_1())
          .when(Boolean(st), (el) => el.child(pill(st)))
          .child(div().id(`open-${i.number}`).p(2).rounded(4).cursor_pointer().hover((s) => s.bg(t.raised))
            .on_click((_e, cx) => { cx.stop_propagation(); cx.open_url(i.url); })
            .child(icon("external", 13, t.dim))))
        .child(div().w_full().max_h(38).overflow_hidden().whitespace_normal().text_size(13).line_height(1.4).text_color(t.foreground).child(i.title))
        .when(i.labels.length > 0, (el) => el.child(h_flex().flex_wrap().gap(5).children(i.labels.map((l) =>
          h_flex().h(18).px(6).gap(5).items_center().rounded(5).bg(t.raised).text_size(10.5).text_color(t.muted)
            .child(div().size(6).rounded(3).bg(`#${l.color}`))
            .child(l.name)))))
        .when(canStart || canMove || moving, (el) => el.child(h_flex().gap(6).pt(1).items_center()
          .when(canStart && !moving, (row) => row
            .child(btn(`plan-${i.number}`, "Plan", true, (cx) => start(v, [i.number], "plan", cx)))
            .child(btn(`run-${i.number}`, "Run", false, (cx) => start(v, [i.number], "auto", cx))))
          .child(div().flex_1())
          .when(moving, (row) => row.child(h_flex().gap(6).items_center().text_size(11.5).text_color(t.muted)
            .child(spinner(11, t.muted)).child("Moving")))
          .when(canMove, (row) => i.status === "Todo"
            ? row.child(btn(`next-${i.number}`, "Move to Next", false, (cx) => move(v, i, "Next", cx)))
            : row.child(btn(`todo-${i.number}`, "Move to Todo", false, (cx) => move(v, i, "Todo", cx))))));
    };

    const rank = (i) => {
      const x = byIssue.get(i.number);
      return x ? ({ need: 0, error: 1, planning: 2, working: 2 }[statusOf(x, v.states).key] ?? 3) : 4;
    };

    const column = (name) => {
      const items = (v.items ?? []).filter((i) => i.status === name).sort((a, b) => rank(a) - rank(b));
      const empty = name === "Next" ? "Nothing in Next." : "Nothing here.";
      return [
        header(t, name === "In Progress" ? "In progress" : name, items.length),
        ...(items.length ? items.map(card) : [div().px(14).pb(10).flex_none().whitespace_normal().text_size(12).text_color(t.dim).child(empty)]),
      ];
    };

    const picks = [...v.picked];
    return v_flex().size_full().bg(t.chrome)
      .when(Boolean(v.error), (el) => el.child(div().m(10).p(10).flex_none().rounded(8).bg(t.blocked + "1e").whitespace_normal().text_size(12).text_color(t.blocked)
        .child(v.items ? `${v.error} Showing the last known board.` : v.error)))
      .child(v.items
        ? v_flex().id("board-scroll").flex_1().min_h(0).overflow_y_scrollbar().children(COLUMNS.flatMap(column))
        : h_flex().flex_1().items_center().justify_center().gap(8).text_size(12).text_color(t.muted)
          .when(!v.error, (el) => el.child(spinner(13, t.muted)).child("Loading board")))
      .when(picks.length > 1, (el) => el.child(h_flex().h(48).px(12).gap(6).flex_none().items_center().border_t(1).border_color(t.border).bg(t.surface)
        .child(div().flex_1().text_size(12).text_color(t.foreground).child(`Start ${picks.length} together`))
        .child(btn("multi-plan", "Plan", true, (cx) => start(v, picks, "plan", cx)))
        .child(btn("multi-run", "Run", false, (cx) => start(v, picks, "auto", cx)))));
  },
};
