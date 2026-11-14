# Contributing to the starter

Rules for the supplied code: `shared/`, `scripts/`, and everything in `exercises/`. They are not rules for guests' code; `AGENTS.md` holds only what a guest's agent needs.

## Layout

| Folder | Piece |
| --- | --- |
| `exercises/00-setup/` | check your Pi |
| `exercises/01-first-package/` | piece 1 |
| `exercises/02-loop/` | piece 2: `02.1` wake me when it's done, `02.2` survive a quit |
| `exercises/03-memory/` | piece 3 |
| `exercises/04-several-agents/` | piece 4 |
| `exercises/05-messages/` | piece 5 |
| `exercises/06-split-the-work/` | piece 6 |

Folder names name the problem, never a tool. An exercise is `exercises/NN-<problem>/NN.M-<name>/` with `exercise.ts`, `readme.md`, the done check and its tests, nothing else. Its environment lives in `shared/<piece>/`. To renumber a piece, rename its folders and change the `id` in its `exercise.ts` and the commands in its readme; the harness keys on nothing else.

## Readmes

Headings: The problem / The environment / Done when. A few lines on the problem, the environment's commands, then the `done` command and what its lines mean. It starts `> DRAFT: Joel rewrites this in his own voice.` No supplied prompt, no hints, at most one closing line pointing at the group chat. A readme names neither a reference tool nor its own catch-up command; the next piece's readme carries both.

## Done checks

- `pnpm ex <id> done` prints `PASS` or `FAIL` per line, and exits 0 only when every line passes.
- Observe, don't import. A check reads its environment's event log. It never imports guest code or depends on a name, file or function we picked.
- To know which Pi did what, stamp events with `sessionFromEnv()` and read the launcher's records with `readSessions()` (`#shared/core/sessions.ts`). A command run by hand stamps null. To know whether a person prompted a session, read `readTurns()` (`#shared/core/turns.ts`).
- "Top-level" (`isTopLevel`) means the launcher found no running recorded Pi among its parent processes and saw no `TMX_SESSION`. The process tree decides first (`scripts/lib/ancestry.ts`), so `env -u TMX_SESSION pnpm pi` from inside a Pi is still nested: it gets its own conversation and the outer Pi's `TMX_GUEST_PI_PID`. Where the tree can't be read, the env rule alone decides. Separately, a launch never resumes a conversation that a running recorded Pi has open: it starts a new one and says so. That covers a Pi whose parent exited (reparented to PID 1, as with `( pnpm pi … ) &`) and a second terminal. Such a launch is still counted top-level, as is any Pi started outside the guest's Pi's process tree. The checks tell a guest when they're done; they aren't anti-cheat, so only routes that damage the guest's repo, session or running Pi get fixed.
- Each check has tests: a naive approach failing for the right reason, a correct approach passing, and a reference approach passing where there is one. They run in `pnpm check`.

## Design rules for supplied code

- Parse every JSON file you read with an Effect `Schema` (`readJson` in `#shared/core/store.ts` does this).
- Write state only under the exercise's `ctx.stateDir`, with `writeJsonAtomic`, or under `.workshop-state/sessions/` through `#shared/core/sessions.ts`.

## Catch-up packages

A piece's working version can ship as a Pi package declared in `.pi/settings.json`, switched off: every resource filter (`extensions`, `skills`, `prompts`, `themes`) set to `[]`. A git package is pinned as `git:<repo>@<sha>`; a local one is a path relative to `.pi/`, such as `../catch-up/<name>`, and lives in the starter. Give it a plain name, never a tool's. Declare a `CatchUpPackage` and add `"catch-up": catchUp(pkg)` (`#shared/core/catch-up.ts`) to the piece's commands. Name the command only in the next piece's readme.

## Public sources

Cite only these public sources in code, docs and readmes: rat-stack, rat-king, pi-until, mischief, pi-muster, pi-bellwether, herdr (`herdrdev/herdr`), herdr-pings, and Pi's own docs. No private paths, notes or machine names. A guest-facing file names a reference tool only after the attempt it belongs to.
