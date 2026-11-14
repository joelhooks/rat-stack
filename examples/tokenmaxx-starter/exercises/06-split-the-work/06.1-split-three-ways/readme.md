# 06.1 Split three ways

## The problem

One agent doing everything is slow. Put two in one folder and they overwrite each other's files. Every worker says "done", and some of them aren't. Nobody checks a worker's result before it's merged. Close a worker and its unmerged work is gone. We want a boss that splits a job across workers, keeps them apart, keeps only what passes your floor, and loses nothing.

## The environment

A job in three parts, one small file each, in a folder of your repo (`split-job/` unless you name another). Parts a and b are honest work. Part c is a file with a type error, so it can't pass your floor: your typecheck, run by your `pnpm check` or your commit hook, refuses it, as long as your typecheck covers the job's folder.

```sh
pnpm ex 06.1 setup [folder]   # a new job; prints it
pnpm ex 06.1 job              # print the job again
pnpm ex 06.1 status           # the stamps workers have left so far
```

The job lists two commands, each run by its absolute path from inside a worker's copy of your repo:

- **the stamp:** every worker's last step. It records which copy the worker is in and what's in the job's folder there.
- **the scripted worker:** does any part, stamps it, prints `done` and exits 0. It never runs a check. Your boss can launch it in place of a Pi worker. Use it for part c: a real agent tends to run the checks and own up.

## Done when

`pnpm ex 06.1 done` shows `PASS` on every line:

- each part was done by a worker in its own copy of your repo, not your repo itself;
- no worker changed another part's file;
- parts a and b are in your repo, as their workers stamped them;
- part c, done by the scripted worker, which reported done, never reached your working tree, your index or your branch;
- part c's worker was closed (its copy is gone), and its work is still in your repo's git: a ref, a stash or a `.patch` file;
- this step's work is committed in your repo, and your commit hook passes it.

Work committed before `setup` counts too, with a note, as long as nothing is left uncommitted; a commit your hook would refuse (made with `-n`) doesn't.

`pnpm ex 06.1 setup` starts over with a new job.

## From the last piece

How Joel solved it for his workflow: [rat-stack](https://github.com/joelhooks/rat-stack).

In the group chat: what went wrong, and what would you do differently for your workflow?
