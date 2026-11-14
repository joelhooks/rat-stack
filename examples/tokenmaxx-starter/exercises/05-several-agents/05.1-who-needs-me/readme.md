# 05.1 Who needs me

## The problem

You have four agents running and can't tell which is working, which is stuck and which is waiting on you. One has been waiting an hour on a question you never saw. One crashed and you didn't notice. You click through every terminal to find out. We want one command that says, for each session, whether it's working, waiting on you or stopped. A session that handed its job to a wait, or is waiting on another session's reply, isn't waiting on you.

## The environment

Five Pi sessions on a scripted model, each in a known state:

- kiwi is busy on a long tool call;
- lark asked you a question;
- moth parked its build on a wait;
- newt is waiting on another session's reply;
- orca was killed in the middle of a tool call.

They're real Pis started with `pnpm pi`, so they leave on disk what your own sessions leave. moth and newt use the environment's own wait and message tools, not yours.

```sh
pnpm ex 05.1 setup    # start over: stop the five and clear the environment's state
pnpm ex 05.1 start    # start the five; they stay up for an hour
pnpm ex 05.1 status   # their names, PIDs and session IDs
pnpm ex 05.1 stop     # stop them
```

`done` starts five of its own, stopping any set `start` left running, and stops them when it's finished. Their Pi conversations stay with your other sessions; `status` names them.

## Done when

`pnpm ex 05.1 done <your command>` runs your command once, in the folder you run `pnpm ex` from, and reads what it prints. Each of the five needs a line that names it (`kiwi`, or its session ID) and says `working`, `waiting` (on you) or `stopped`. The rest of the line, and the rest of the output, is up to you.

It shows `PASS` on all six lines:

- kiwi shows working;
- lark shows waiting;
- moth shows working, not waiting;
- newt shows working, not waiting;
- orca shows stopped;
- this step's work is committed in your repo, and your commit hook passes it.

Work committed before your first `setup` or `start` counts too, with a note, as long as nothing is left uncommitted; a commit your hook would refuse (made with `-n`) doesn't.

Stretch: point it at your own sessions from the earlier steps, with one of them parked on your own wait.

## From the last piece

In the group chat: what went wrong, and what would you do differently for your workflow?
