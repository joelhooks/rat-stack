> DRAFT: Joel rewrites this in his own voice.

# 01.1 Don't take its word for it

## The problem

Ask an agent for something and it takes the shortest path, then says "done". It skips the typecheck, fakes the check, or writes a file nothing ever loads. We want a repo that says why it exists, refuses broken work on its own, and gives every fresh session your own tools and skills, so later pieces have somewhere to live.

## The environment

This repo, and whatever you and your agent build in it. Nothing is supplied in code. Two public references:

- [rat-stack](https://ratstack.sh/llms.txt): one way to build TypeScript agent tooling.
- Pi's docs on packages, extensions and skills: `node_modules/@earendil-works/pi-coding-agent/docs/` (`packages.md`, `extensions.md`, `skills.md`).

## Done when

`pnpm ex 01.1 done` shows `PASS` on all three lines:

- **a type-broken commit is refused.** The check makes a throwaway copy of your repo with `git worktree`, with your uncommitted files in it, and tries two commits there: one that adds a type error and the same one without it. The first must be refused and the second must go through. Your repo is left exactly as it was.
- **a fresh Pi session loads a tool and a skill from this repo.** The check starts a new Pi in this repo against a fake model on your machine, so no tokens are spent, and reads which tools and skills it was given. Only ones that come from this repo count; any your own Pi setup adds are listed in a note.
- **the repo says why it exists.** A non-empty `VISION` or `WHY` file (any extension) at the repo root.

A `STRETCH` line may follow. It says whether the fence still holds when the commit is made with `git commit -n` or `LEFTHOOK=0`. It never fails the check. `pnpm ex 01.1 status` shows the last result again.

In the group chat: what went wrong, and what would you do differently for your workflow?
