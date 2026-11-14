> DRAFT: Joel rewrites this in his own voice.

# 03.1 Yesterday's mistake

## The problem

Every session starts from zero. Your agent gets something wrong, you tell it why, it fixes it, and the next session makes the same mistake. We want a fresh session to start out knowing what earlier sessions learned. When a lesson stops being true, the next session should drop it, not repeat it.

## The environment

A release log with a house rule that nobody wrote down. A session asks for a task, writes one line for the log, and hands it in. A line that breaks the rule is rejected, and the rejection says why. The team can change the rule.

Start each session with `pnpm pi --exercise 03.1 --fresh`. That makes a new Pi conversation. Without `--fresh`, Pi resumes the last one, and a resumed session isn't fresh.

```sh
pnpm ex 03.1 setup                # start over: a new house rule, nothing handed in
pnpm ex 03.1 task                 # a new task for this session
pnpm ex 03.1 submit "<your line>" # hand in a line for this session's task
pnpm ex 03.1 status               # hand-ins so far, by session
pnpm ex 03.1 change-rule          # the team changes the house rule
```

## Done when

`pnpm ex 03.1 done` shows `PASS` on all four lines:

- a session broke the house rule, was told why, then passed;
- a fresh session, started after that, passed on its first try;
- the house rule changed after that;
- a fresh session, started after the change, followed the new rule on its first try and never wrote the old one.

Only hand-ins from a Pi started with `pnpm pi` count; `status` shows whether the session you're in does. `pnpm ex 03.1 setup` starts over with a new rule.

> DRAFT line for Joel: You start each session yourself, from a terminal, and you run `change-rule`. A Pi your agent starts from inside its own session doesn't count; `done` notes it and moves on.

> DRAFT line for Joel: Stretch: make your agent tell you, unasked, when a lesson it holds stops being true.

## From the last piece

How Joel solved the loop for his workflow: [pi-until](https://github.com/joelhooks/pi-until). Behind? `pnpm ex 02.1 catch-up` switches on a working wait.

In the group chat: what went wrong, and what would you do differently for your workflow?
