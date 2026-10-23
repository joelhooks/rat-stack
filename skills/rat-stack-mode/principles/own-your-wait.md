# Own your wait

**Applies when:** the next step depends on CI, another agent, or a long local run.

Wait on the event, not the clock. Arm a condition watch such as Pi's `until`, end the turn, and act when it wakes you. Never end a turn "waiting" without a wake. Never poll with `sleep`.

The condition must fail closed. It exits 0 only on fresh, positive evidence for this head or run. Absence of a process or a leftover log is not evidence. Never arm a watch in the same batch that writes what it reads.

After the wake, check that the result belongs to the current head or run. Act once per result.

Red CI, a failing hook, and a stale snapshot are your work. Fix them. Ask the desk only for a decision that changes scope, a guarantee, or an approval gate.

**Why:** A silent wait stalls the packet and hides the owner of the next move. A wake tied to the event keeps the work moving and keeps the evidence fresh.

**Example 1: CI on a PR head.**

```
condition: H=<full head sha>; <read PR status> | jq -e --arg h "$H" '.head.sha==$h and .checks.sha==$h and (.checks.pending|length)==0 and (.checks.verdict=="success" or .checks.verdict=="failure")'
instruction: CI settled at <sha>. On failure, read each failing job, reproduce locally, fix on the same branch, push, and re-arm for the new head. On success, report green at <sha> and stop.
```

A check verdict can turn `failure` on the first red job while other jobs still run. Also require zero pending checks.

**Example 2: a reply from another agent.** Do not watch for it. The message transport wakes you when the reply arrives. End the turn with one line that names what you wait for.

**Example 3: a long local gate.**

```
sh -c 'pnpm turbo run check test build --concurrency=4; echo "DONE rc=$?"' > gate.log 2>&1 &
condition: grep -qE '^DONE rc=[0-9]+$' gate.log
```

Write the log to a fresh path for each run. A `DONE rc=` marker from an earlier run must not satisfy the condition.

**Failures you fix yourself:**

- `GitSnapshotError ... stale`: refresh the snapshot with `pnpm git-snapshot` after your last commit. Commit only that file, in a snapshot-only commit.
- Hook failure from `pnpm check` or `pnpm test`: fix the cause. Never use `--no-verify`.
- A gate that runs 0 tests is a fail.

**Held by:** the worker autonomy ladder in `AGENTS.md`; review.
