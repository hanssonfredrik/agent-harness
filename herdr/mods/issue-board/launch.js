import { hc } from "herdr";
import { SPACE, agentDir } from "./lib.js";

// Starts Claude in its own tab of the board's space; resolves with its terminal address.
// Only issue numbers go into arguments, never text from GitHub.
export async function launch(p, numbers, mode) {
  const dir = agentDir();
  const tab = `tbboard${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const args = ["run", "--bg", "--json", "--no-parent", "--keep", "--cwd", p.folder,
    "--label", `herdr.space=${SPACE}`, "--label", `herdr.tab=${tab}`];
  if (numbers.length) args.push("--label", `board.issues=${numbers.join("-")}`);
  args.push("--", "claude", "--settings", `${dir}/settings.json`, "--append-system-prompt-file", `${dir}/prompt.md`);
  if (numbers.length) {
    const many = numbers.length > 1;
    args.push("--worktree", `issue-${numbers.join("-")}`, "--permission-mode", mode,
      `Work on ${many ? "issues" : "issue"} ${numbers.map((n) => `#${n}`).join(", ")} in ${p.repo}. Read ${many ? "each" : "it"} with gh issue view.`);
  }
  const r = await hc(args);
  if (r.code !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout).address;
}
