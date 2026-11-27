#!/usr/bin/env node
// Moves issues on a GitHub project board by setting their Status. For repos that have no script of
// their own: point `moveCommand` in harness.config.json at this file with the owner and project.
//
//   node project-status.mjs <owner> <project-number> <status> <issue> [<issue> ...]
//   status: todo | next | in-progress | done, or any Status option name
//
// One gh call per step, no shell. The gh account needs the `project` scope (gh auth refresh -s project).
import { execFileSync } from 'node:child_process';

const gh = (...args) => JSON.parse(execFileSync('gh', [...args, '--format', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));

const [owner, project, status, ...issues] = process.argv.slice(2);
if (!owner || !/^\d+$/.test(project ?? '') || !status || !issues.length || issues.some((n) => !/^\d+$/.test(n))) {
  console.error('usage: project-status.mjs <owner> <project-number> todo|next|in-progress|done <issue> [<issue> ...]');
  process.exit(2);
}

const wanted = status.replace(/-/g, ' ').toLowerCase();
const field = gh('project', 'field-list', project, '--owner', owner).fields.find((f) => f.name === 'Status');
const option = field?.options?.find((o) => o.name.toLowerCase() === wanted);
if (!option) {
  console.error(`No Status option "${status}". The board has: ${(field?.options ?? []).map((o) => o.name).join(', ')}`);
  process.exit(2);
}
const projectId = gh('project', 'view', project, '--owner', owner).id;
const items = gh('project', 'item-list', project, '--owner', owner, '--limit', '500').items;

let failed = false;
for (const issue of issues) {
  const item = items.find((i) => i.content?.number === Number(issue));
  if (!item) {
    console.error(`#${issue} is not on the board.`);
    failed = true;
    continue;
  }
  execFileSync('gh', ['project', 'item-edit', '--project-id', projectId, '--id', item.id, '--field-id', field.id,
    '--single-select-option-id', option.id], { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`#${issue}: ${option.name}`);
}
process.exit(failed ? 1 : 0);
