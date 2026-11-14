# tokenmaxx-starter

> DRAFT: Joel rewrites in his voice.

The starter for the Tokenmaxx workshop. You build your own agent factory, one piece at a time. Each piece is a problem: the starter gives you the problem, an environment to work in and a check that says when you're done. The design, the names and the layout are yours.

## Setup

You need Node 24.18 or newer and pnpm 11.3. Pi is installed with the repo, so you do not need a global one.

```sh
pnpm install
pnpm pi            # once: accept project trust, pick a model with /model, then /quit
pnpm ex 00.1 check # proves a real model turn, a tool call, the pinned packages, and two Pi sessions at once
```

Project trust lets Pi load `.pi/settings.json`, which pins the workshop's packages to exact commits. Pi installs them into `.pi/git/` on the first trusted start. They stay switched off until you ask for them.

## Fallback folder

A spare copy of the repo, for a guest whose clone or install fails on the day. Prepare it once while online:

```sh
pnpm install
pnpm offline:prepare   # the pinned packages into .pi/git/, then trust for this folder
```

Copy the whole folder, `node_modules/` and `.pi/git/` included, to a machine of the same OS and CPU (`node_modules/` holds platform binaries). Then, in the copy:

```sh
export pnpm_config_verify_deps_before_run=warn   # first, in every terminal you use in the copy
pnpm offline:prepare                              # no network needed this time
pnpm pi
```

The export comes first because pnpm checks the path `pnpm install` ran in, and the copy has a new one. Without it every `pnpm` script stops with `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN The workspace structure has changed since last install`. Don't run `pnpm install` in the copy instead: it wants to remove `node_modules/` and reinstall from a pnpm store the copy doesn't have.

The second `pnpm offline:prepare` finds the pinned packages already there and saves trust for the copy's own path. Pi keys trust by folder path, in `trust.json` in your Pi agent dir, so a copied folder starts out untrusted. Then `pnpm pi` starts without the network and without the trust prompt. If you skip that step, Pi asks for trust once; accept it, and it uses the copy's packages, still without the network.

Pi still needs to reach your model provider. `.pi/git/` stays out of git on purpose.

## Layout

```text
exercises/
  00-setup/00.1-check-your-pi/
  01-first-package/01.1-dont-take-its-word/
  02-loop/02.1-wake-me-when-done/
  02-loop/02.2-survive-a-quit/
  03-memory/03.1-yesterdays-mistake/
  04-several-agents/
  05-messages/
  06-split-the-work/
shared/          the environments each exercise runs in, imported as #shared/...
scripts/         the exercise runner and the Pi launcher
.workshop-state/ runtime state, one folder per exercise (git-ignored)
```

Each exercise folder holds a `readme.md` (the problem, the environment, how you know you're done), an `exercise.ts` that declares its commands, and its done check's tests. Your own code doesn't go there: put it wherever you like, usually in your own Pi package.

```sh
pnpm ex                          # list exercises and commands
pnpm ex 02.1 setup               # reset the exercise's environment
pnpm ex 02.1 status              # what the environment shows now
pnpm ex 02.1 done                # the done check: PASS or FAIL per line
pnpm ex 02.1 test                # the done check's own tests
```

## Pi sessions

Start Pi with `pnpm pi`, optionally for an exercise and a role. Each exercise and role gets its own Pi session, and relaunching resumes it:

```sh
pnpm pi --exercise 02.1
pnpm pi --exercise 02.1 --role second
```

To start over with an empty conversation, add `--fresh`. It gives Pi a new session ID (the usual one plus a timestamp). The next plain `pnpm pi` goes back to the usual session. A `pnpm pi` run from inside another Pi, by an agent testing its own work, always starts a new conversation, so it never writes into the one you have open.

Every `pnpm pi` is also a new workshop session. The launcher writes a record for it in `.workshop-state/sessions/<session>.json` when Pi starts and again when it exits (how it ended: `quit`, `error` or `signal`; a SIGTERM or SIGHUP the launcher passed on to Pi counts as `signal`), notes which Pi started it, if any, and sets `TMX_SESSION` for Pi and everything Pi runs. It also sets `TMX_GUEST_PI_PID` to the PID of your own `pnpm pi`, which a Pi started from inside it keeps, so an agent can tell your session from its test Pis. Exercise commands can stamp their events with it, so a done check can tell which session did what. A command you run by hand in another terminal has no session. The launcher also loads a small extension into Pi that notes, in `.workshop-state/sessions/<session>.turns.jsonl`, each time Pi gets a prompt and where it came from (typed, `-p`, RPC, an extension, or a `!command`), without the prompt's text. It adds no tools.

## Checks

```sh
pnpm check          # typecheck, lint, format and tests for the supplied code
pnpm check:pi       # one real Pi turn with a tool call, and the pinned packages on disk
pnpm format         # format the supplied code
```

`pnpm check` covers `scripts/`, `shared/`, `exercises/` and the root config. It never looks at your code.
