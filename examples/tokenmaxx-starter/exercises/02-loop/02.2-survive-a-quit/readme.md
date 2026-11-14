> DRAFT: Joel rewrites this in his own voice.

# 02.2 Survive a quit

## The problem

The job is still running and the session goes away: you quit Pi to restart it, update something, or go home. The wait goes with it. Start Pi again and nothing remembers there was a job, so you're back to asking "done yet?". We want the wait to outlive the session: start the job, quit, start Pi again, and the agent picks up the result on its own, once.

## The environment

The same job as 02.1, with its own state. Start Pi with `pnpm pi --exercise 02.2`. Starting it the same way again resumes the same conversation.

```sh
pnpm ex 02.2 setup               # reset the job
pnpm ex 02.2 start               # start a run; it finishes on its own later
pnpm ex 02.2 status              # the current run, result.json, and what was consumed
pnpm ex 02.2 consume <resultId>  # use a result
pnpm ex 02.2 release             # finish the current run now, from any terminal
```

`pnpm pi` keeps a record of every Pi it starts: when it started, how it ended, and when a person prompted it. The done check reads those records and the job, not your code.

Also try `/reload` in the middle of a wait.

## Done when

`pnpm ex 02.2 done` shows `PASS` on all five lines:

- the current run was started in a Pi session;
- that session quit (`/quit` or Ctrl+D) before the run finished;
- its result was consumed exactly once, in a session started after the quit;
- nobody prompted that later session before the consume;
- no stale result was consumed: nothing from a run before the current one.

`pnpm ex 02.2 setup` starts over.

> DRAFT line for Joel: You do the quitting. You start the run from a Pi you launched with `pnpm pi --exercise 02.2`, you quit it, and you start Pi again. Only Pis you start from a terminal count. If your agent tests its work in a Pi it starts itself, good, but `done` notes those and doesn't count them.

Stretch: kill Pi instead of quitting it (`kill -9` on its process) and see what's left. A wait that survives that lives outside Pi, which is where real infrastructure comes in.

In the group chat: what went wrong, and what would you do differently for your workflow?
