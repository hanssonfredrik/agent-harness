// One mod, six views: props.view is "board", "actions", "now", "subagents", "usage" or "bar".
import { View, div } from "gpui-kit";
import { props } from "herdr";
import { board } from "./board.js";
import { actions } from "./actions.js";
import { now } from "./now.js";
import { subagents } from "./subagents.js";
import { bar } from "./bar.js";
import { usage } from "./usage.js";

const VIEWS = { board, actions, now, subagents, usage, bar };

export default class IssueBoard extends View {
  init(_props, cx) {
    this.view = VIEWS[props()?.view] ?? board;
    this.view.init(this, cx);
  }

  render(cx) {
    return this.view ? this.view.render(this, cx) : div();
  }
}
