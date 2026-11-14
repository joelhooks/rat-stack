> DRAFT: Joel rewrites this in his own voice.

# 02.1 Wake me when it's done

## The problem

You give your agent a job that takes a while. It starts the job, its turn ends, and it stops. Nothing brings it back when the job finishes, so you sit there asking "done yet?". We want the agent to find out on its own, use the result once, and tell you.

## The environment

A job that takes several minutes and finishes at a time nobody is told: not you, and not your agent. Start Pi with `pnpm pi --exercise 02.1`.

```sh
pnpm ex 02.1 setup               # reset the job
pnpm ex 02.1 start               # start a run; it finishes on its own later
pnpm ex 02.1 status              # the current run, result.json, and what was consumed
pnpm ex 02.1 consume <resultId>  # use a result
pnpm ex 02.1 release             # finish the current run now, from any terminal
```

A finished run publishes a result with an ID like `res_…`.

## Done when

`pnpm ex 02.1 done` shows `PASS` on all three lines:

- the current run finished;
- its result was consumed exactly once;
- no stale result was consumed: nothing from a run before the current one.

`pnpm ex 02.1 setup` starts over.

Stretch: keep working with your agent while it waits.

## From the last piece

How Joel solved it for his workflow: [rat-stack](https://github.com/joelhooks/rat-stack). Behind? `pnpm ex 01.1 catch-up` switches on a starter package.

In the group chat: what went wrong, and what would you do differently for your workflow?
