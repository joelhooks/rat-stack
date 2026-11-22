# Agent instructions

This repo is a workshop starter. Each exercise's readme explains a problem, the environment it runs in, and how to know you're done.

Reference: https://ratstack.sh/llms.txt. Read it before building anything here.

## The rule

Don't edit the harness, the environments or the checks: `scripts/`, `shared/`, and the files in `exercises/`. Build your own code anywhere else. `.workshop-state/` is runtime state: read it to debug, and change it only through exercise commands.

## Commands

```sh
pnpm ex                                  # list exercises and their commands
pnpm ex <id> <command>                   # run a command, e.g. pnpm ex 02.1 status
pnpm ex <id> done                        # that exercise's done check: PASS or FAIL per line
pnpm ex <id> test                        # the done check's own tests
pnpm pi [--role <name>] [--exercise <id>] [--fresh]   # start the pinned Pi; --fresh starts a new session
pnpm check                               # typecheck + lint + test (supplied code only)
```

## How work gets checked here

- `pnpm check` runs every check on the supplied code through Turbo: each workspace package's typecheck and tests (`shared/<piece>`, `scripts`, `exercises/<NN-problem>`), plus the root's typecheck, lint and format. Results are cached in `.turbo/`, so a second run with nothing changed takes about a second, and a change reruns only what depends on it. A red check is real: fix it, never skip it.
- When this folder is its own git repository, every commit runs `pnpm check` from `.githooks/prepare-commit-msg` and a red check refuses the commit. `git commit -n` doesn't skip it. Don't try to get around it: no `-c core.hooksPath=...`, no hook edits.
- `pnpm check` doesn't look at your own code. Give your code its own checks.

## Runtime facts

- Node runs TypeScript directly. Import with the `.ts` extension. Use only erasable syntax: no `enum`, no `namespace`, no constructor parameter properties.
- If you use Effect, it's Effect 4 (`effect` 4.1.4), not Effect 3. Common renames: `Effect.catchAllCause` → `Effect.catchCause`, `Effect.catchAll` → `Effect.catch`, `Either` → `Result` (`Effect.either` → `Effect.result`), `Context.Tag` → `Context.Service`. Check a name in `node_modules/effect/src` before using it.
- To see env names, run `env | cut -d= -f1`. For the workshop's own values (TMX_SESSION and friends, none secret), run `pnpm ex <id> status` and show them freely. Never print other env values.
- `pnpm pi` sets `TMX_SESSION` for Pi and everything it runs, and records each session under `.workshop-state/sessions/`.
- Don't stop a `pnpm pi` you didn't start; stop your own test Pis by PID. `TMX_GUEST_PI_PID` is the guest's own `pnpm pi` (Pi runs as its child), in that Pi and every Pi started from inside it.
