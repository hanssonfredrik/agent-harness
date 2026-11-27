# usage-bar

A Claude Code mod that shows your model, effort level and plan usage above the prompt, so you don't have to open `/usage` to see how much is left.

```
Model         claude-fable-5-2  · effort medium
Session       ████████████████░░░░░░░░░░░░░░░░░░░░░░░░  38% left  · resets in 2h 14m
Week          ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  79% (40% fable) left  · resets in 3d 4h
```

- **Model** is the session's current model. It follows `/model`.
- **effort** is the level the last request really ran at. It follows `/effort` at once. Nothing is shown until the first prompt or `/effort` of a session, because the settings file does not say what Claude Code resolves per model.
- **Session** and **Week** are the plan's 5-hour and 7-day windows. Bars turn yellow at 50% used and red at 80%.
- **(40% fable)** is how much of the Fable-only weekly limit is left. It appears only on plans that have one.

## Requirements

- Claude Code 2.1.325 or later, signed in with a Claude subscription (Pro, Max or Team). An API key or a third-party provider has no plan windows to show.

## Install

From a zip: unpack it so that this file ends up at `~/.claude/skills/usage-bar/README.md` (on Windows `C:\Users\<you>\.claude\skills\usage-bar\README.md`), then restart Claude Code.

To try it without installing:

```
claude --plugin-dir /path/to/usage-bar
```

## Use

The bars show by themselves. `/usage-bar` turns them off and on; the choice is remembered.

## What it reads

- The session's rate-limit windows, model and effort, from Claude Code itself.
- `https://api.anthropic.com/api/oauth/usage`, the endpoint `/usage` reads, for the Fable weekly limit. The request is made by Claude Code with your own login; the mod never sees the credential. It is asked at most every five minutes and backs off when rate limited.
- `~/.claude.json`, only for the usage reading Claude Code last cached there, used when the endpoint refuses and the reading is under an hour old.
- The session's context fill and where auto-compaction starts, from Claude Code itself. Reading the compaction point uses the local `summary` breakdown, which sends no request.

## What it saves

In its own store, `~/.claude/plugins/store/usage-bar_*.json`, for tools outside Claude Code such as the Herdr Usage panel:

- `snapshot`: the latest model, effort, plan windows and Fable figure. A session without a plan reading yet keeps the last one saved.
- `context:<terminal>`: one session's context tokens, window and compaction point, only when the session runs in a Herdr terminal (`HC_TERMINAL_ID`). It is removed when the session ends, and readings older than a day at the next start.

Nothing is sent anywhere else and nothing is written outside the mod's own store.

## If the Fable figure is missing

The mod notes where its last reading came from. Look for `fableSource` in the file `~/.claude/plugins/store/usage-bar_*.json`:

- `api (Fable=30)`: read live.
- `api: 429 rate limited ...; shown from the cached reading`: the endpoint is rate limited; the figure is the cached one and catches up by itself.
- `api: no Fable limit in the response`: your plan has no Fable-only weekly limit.

## Develop

```
claude plugin validate .
claude plugin test .
```
