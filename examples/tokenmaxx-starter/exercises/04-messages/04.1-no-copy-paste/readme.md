# 04.1 No copy and paste

## The problem

Your agents can't send each other anything. When one needs something another one knows, you copy it out of one terminal and paste it into the other. You send something and don't know if it arrived. We want one session to ask another a question by name and get the answer back, with you carrying nothing. A message to a name nobody has should fail where you can see it.

## The environment

Each session can be shown a secret that nobody else sees. A session hands in a secret it got from another one.

```sh
pnpm ex 04.1 setup             # start over: no secrets shown, nothing handed in
pnpm ex 04.1 secret            # show this session a new secret
pnpm ex 04.1 answer <secret>   # hand in a secret another session was shown
pnpm ex 04.1 status            # what has happened since setup, by session
```

Sessions need names. Start each one in its own terminal with a role, which names its Pi session; inside Pi the role is in `TMX_ROLE`:

```sh
pnpm pi --exercise 04.1 --role a
pnpm pi --exercise 04.1 --role b
```

Two plain `pnpm pi` would both be `main`.

## Done when

Type one question into session A, something like "Ask the session named b for a secret: it gets one with `pnpm ex 04.1 secret`. Hand in what it sends back with `pnpm ex 04.1 answer`." Then type nothing into either session until it's handed in. Then ask A to send a message to `ghost`, a name nobody has.

`pnpm ex 04.1 done` shows `PASS` on all four lines:

- the answer came back to the session that asked;
- nobody typed into either session to carry it;
- a message from A to `ghost` failed where A could see it: the call that sent it came back as an error, or a message saying it failed came back to A;
- this step's work is committed in your repo, and your commit hook passes it.

Work committed before `setup` counts too, with a note, as long as nothing is left uncommitted; a commit your hook would refuse (made with `-n`) doesn't.

Both sessions have to be Pis you started with `pnpm pi`; `status` shows whether the session you're in counts. `pnpm ex 04.1 setup` starts over.

## From the last piece

How Joel solved memory for his workflow: [rat-stack](https://github.com/joelhooks/rat-stack).

In the group chat: what went wrong, and what would you do differently for your workflow?
