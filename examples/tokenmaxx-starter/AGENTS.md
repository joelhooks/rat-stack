# Agent instructions

This repo is a workshop starter. Each exercise's readme explains a problem, the environment it runs in, and how to know you're done.

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

## Runtime facts

- Node runs TypeScript directly. Import with the `.ts` extension. Use only erasable syntax: no `enum`, no `namespace`, no constructor parameter properties.
- If you use Effect, it's Effect 4 (`effect` 4.1.2), not Effect 3. Common renames: `Effect.catchAllCause` → `Effect.catchCause`, `Effect.catchAll` → `Effect.catch`, `Either` → `Result` (`Effect.either` → `Effect.result`), `Context.Tag` → `Context.Service`. Check a name in `node_modules/effect/src` before using it.
- `pnpm pi` sets `TMX_SESSION` for Pi and everything it runs, and records each session under `.workshop-state/sessions/`.
- Don't stop a `pnpm pi` you didn't start; stop your own test Pis by PID. `TMX_GUEST_PI_PID` is the guest's own `pnpm pi` (Pi runs as its child), in that Pi and every Pi started from inside it.
