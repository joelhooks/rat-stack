import type { ExerciseContext } from "#shared/core/context.ts";
import { defineExercise, type Exercise } from "#shared/core/exercise.ts";
import {
  isTopLevel,
  readSessions,
  type SessionRecord,
  sessionFromEnv,
} from "#shared/core/sessions.ts";

import { judge, notes, notFresh } from "./judge.ts";
import {
  appendEvent,
  type MemoryEvent,
  newTaskId,
  openTask,
  readEvents,
  resetLog,
  ruleSets,
  type TaskIssued,
  type Verdict,
} from "./log.ts";
import {
  follows,
  type HouseRule,
  houseRules,
  mentions,
  type Person,
  seal,
  unseal,
  usesForm,
} from "./rules.ts";

// The commands for the memory piece. A session asks for a task, writes one
// line for the release log, and hands it in. The house rule decides how the
// person in that line is written; a hand-in that breaks it is rejected with
// the reason. Nothing here says the rule before a rejection does, and
// `status` never says it at all.

export type MemoryDeps = {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly now: () => Date;
  /** A number in [0, 1). */
  readonly random: () => number;
  /** The workshop session running this command, or null in a plain terminal. */
  readonly session: () => string | null;
  readonly readSessions: (repoRoot: string) => Promise<SessionRecord[]>;
};

const defaultDeps: MemoryDeps = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  now: () => new Date(),
  random: Math.random,
  session: () => sessionFromEnv(),
  readSessions,
};

/** Who ships things. No two-letter initials here spell a word. */
export const people: readonly Person[] = [
  { first: "Priya", last: "Nair" },
  { first: "Lena", last: "Fischer" },
  { first: "Ravi", last: "Mehta" },
  { first: "Jonas", last: "Whitaker" },
  { first: "Mara", last: "Lindqvist" },
  { first: "Dev", last: "Kowalski" },
  { first: "Tariq", last: "Haddad" },
  { first: "Grace", last: "Tanaka" },
  { first: "Owen", last: "Brandt" },
  { first: "Nadia", last: "Reyes" },
];
const services = [
  "invoices",
  "search",
  "payments",
  "ledger",
  "mailer",
  "exports",
  "checkout",
  "reports",
];
const summaries = [
  "fixes rounding on refunds",
  "adds a CSV download",
  "speeds up the nightly sync",
  "retries failed webhooks",
  "trims noisy logs",
  "drops the old login page",
  "caches the price lookups",
  "fixes the timezone on receipts",
];

/** The person `change-rule` uses as its example. */
export const examplePerson: Person = { first: "Ada", last: "Lovelace" };

const pick = <A>(items: readonly A[], random: () => number): A => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error("pick from an empty list");
  }
  return item;
};

const ex = (ctx: ExerciseContext, command: string) =>
  `pnpm ex ${ctx.exerciseId} ${command}`;

const personOf = (task: TaskIssued): Person => ({
  first: task.first,
  last: task.last,
});

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Review = {
  readonly verdict: Verdict;
  readonly usedRetired: boolean;
  /** What to tell whoever handed it in, one line each. */
  readonly reasons: readonly string[];
};

/** Judges one entry for `task` under `rule`, with `retired` the rules that came before. */
export function review(
  entry: string,
  task: TaskIssued,
  rule: HouseRule,
  retired: readonly HouseRule[]
): Review {
  const person = personOf(task);
  const missing: string[] = [];
  if (!new RegExp(`\\b${escape(task.service)}\\b`, "i").test(entry)) {
    missing.push(`the service (${task.service})`);
  }
  if (
    !new RegExp(`(?<![\\w.])v?${escape(task.release)}(?!\\w|\\.\\d)`).test(
      entry
    )
  ) {
    missing.push(`the release (${task.release})`);
  }
  const named = mentions(entry, person);
  if (!named) {
    missing.push("who shipped it");
  }
  const reasons: string[] = [];
  if (missing.length > 0) {
    reasons.push(`The entry doesn't say ${missing.join(" or ")}.`);
  }
  const old = retired.filter(
    (r) => r.id !== rule.id && usesForm(r, entry, person)
  );
  const broke = named && !follows(rule, entry, person);
  if (broke) {
    reasons.push(
      old.length > 0
        ? `That's the old house rule, and it changed. Now ${rule.says(person)}. Write no other form of the name.`
        : `House rule: ${rule.says(person)}. Write no other form of the name.`
    );
  }
  return {
    verdict: broke ? "rule" : missing.length > 0 ? "content" : "accepted",
    usedRetired: old.length > 0,
    reasons,
  };
}

export function memoryExercise(
  opts: { readonly id: string; readonly title: string },
  deps: MemoryDeps = defaultDeps
): Exercise {
  const { out, err } = deps;

  const setRule = async (
    ctx: ExerciseContext,
    version: number,
    rule: HouseRule
  ) => {
    await appendEvent(ctx.stateDir, {
      _tag: "RuleSet",
      version,
      ...seal(rule.id),
      at: deps.now().toISOString(),
      session: deps.session(),
    });
  };

  const startOver = async (ctx: ExerciseContext) => {
    await resetLog(ctx.stateDir);
    await setRule(ctx, 1, pick(houseRules, deps.random));
  };

  /** The rule in force and the ones it replaced, oldest first. */
  const rulesIn = (events: readonly MemoryEvent[]) => {
    const all = ruleSets(events).map((r) => ({
      version: r.version,
      rule: unseal(r),
    }));
    const current = all.at(-1);
    return current === undefined
      ? null
      : { current, retired: all.slice(0, -1).map((r) => r.rule) };
  };

  return defineExercise({
    id: opts.id,
    title: opts.title,
    commands: {
      /** Starts over: a new house rule, nothing handed in. */
      async setup(ctx) {
        await startOver(ctx);
        out(
          "Fresh start: a new house rule is in force, and nothing has been handed in."
        );
        out(`Next: ${ex(ctx, "task")}`);
        return 0;
      },

      /** Gives this session a new task. */
      async task(ctx) {
        if (ruleSets(await readEvents(ctx.stateDir)).length === 0) {
          await startOver(ctx);
        }
        const session = deps.session();
        const person = pick(people, deps.random);
        const task: TaskIssued = {
          _tag: "TaskIssued",
          taskId: newTaskId(),
          service: pick(services, deps.random),
          release: `${1 + Math.floor(deps.random() * 4)}.${Math.floor(deps.random() * 13)}.${Math.floor(deps.random() * 10)}`,
          first: person.first,
          last: person.last,
          summary: pick(summaries, deps.random),
          at: deps.now().toISOString(),
          session,
        };
        await appendEvent(ctx.stateDir, task);
        out(`Task ${task.taskId}:`);
        out(
          `  Write one line for the release log: ${person.first} ${person.last} shipped ${task.service} ${task.release}, which ${task.summary}.`
        );
        out(`Hand it in: ${ex(ctx, 'submit "<your line>"')}`);
        if (session === null) {
          out(
            "This terminal isn't a Pi session started with pnpm pi, so its hand-ins don't count toward done."
          );
        }
        return 0;
      },

      /** Hands in a line for this session's task. Every hand-in is recorded. */
      async submit(ctx, args) {
        const entry = args.join(" ").trim();
        if (entry === "") {
          err(`Usage: ${ex(ctx, 'submit "<your line>"')}`);
          return 2;
        }
        const events = await readEvents(ctx.stateDir);
        const session = deps.session();
        const open = openTask(events, session);
        if (open === null) {
          err(`No task for this session yet. Get one: ${ex(ctx, "task")}`);
          return 1;
        }
        if (open.accepted) {
          err(
            `${open.task.taskId} was already accepted. Get a new one: ${ex(ctx, "task")}`
          );
          return 1;
        }
        const rules = rulesIn(events);
        if (rules === null) {
          err(`No house rule yet. Run ${ex(ctx, "setup")}`);
          return 1;
        }
        const result = review(
          entry,
          open.task,
          rules.current.rule,
          rules.retired
        );
        await appendEvent(ctx.stateDir, {
          _tag: "Submitted",
          taskId: open.task.taskId,
          ruleVersion: rules.current.version,
          verdict: result.verdict,
          usedRetired: result.usedRetired,
          at: deps.now().toISOString(),
          session,
        });
        if (result.verdict === "accepted") {
          out(`Accepted: ${open.task.taskId} is in the release log.`);
          return 0;
        }
        out(`Rejected: ${open.task.taskId} is not in the release log.`);
        for (const reason of result.reasons) {
          out(`  ${reason}`);
        }
        out(`Fix it and hand it in again: ${ex(ctx, 'submit "<your line>"')}`);
        return 1;
      },

      /** The team changes the house rule. Says the old one is wrong now. */
      async "change-rule"(ctx) {
        const events = await readEvents(ctx.stateDir);
        const rules = rulesIn(events);
        if (rules === null) {
          err(`No house rule yet. Run ${ex(ctx, "setup")}`);
          return 1;
        }
        const used = new Set([
          ...rules.retired.map((r) => r.id),
          rules.current.rule.id,
        ]);
        const fresh = houseRules.filter((r) => !used.has(r.id));
        const next = pick(
          fresh.length > 0
            ? fresh
            : houseRules.filter((r) => r.id !== rules.current.rule.id),
          deps.random
        );
        const sessions = await deps.readSessions(ctx.repoRoot);
        const before = judge(events, sessions);
        await setRule(ctx, rules.current.version + 1, next);
        const p = examplePerson;
        out("The house rule changed.");
        out(
          `  Old, and wrong now: ${rules.current.rule.says(p)}. Entries written that way are rejected from now on.`
        );
        out(`  New: ${next.says(p)}. Write no other form of the name.`);
        if (!(before[0]?.ok === true && before[1]?.ok === true)) {
          out(
            `Heads up: done wants both sessions under the first rule to pass before this change. ${ex(ctx, "setup")} starts over.`
          );
        }
        return 0;
      },

      /** What has happened so far, by session. Never shows the rule. */
      async status(ctx) {
        const events = await readEvents(ctx.stateDir);
        const rules = ruleSets(events);
        if (rules.length === 0) {
          out(`No house rule yet. Run ${ex(ctx, "setup")}`);
          return 0;
        }
        const changes = rules.length - 1;
        out(
          changes === 0
            ? "House rule:   the first one, unchanged"
            : `House rule:   changed ${changes} time${changes === 1 ? "" : "s"}, last at ${(rules.at(-1)?.at ?? "").slice(11, 19)} UTC`
        );
        const session = deps.session();
        const sessions = await deps.readSessions(ctx.repoRoot);
        const record = sessions.find((s) => s.session === session) ?? null;
        const stale = notFresh(record, sessions);
        out(
          session === null
            ? "This session: none, not a Pi started with pnpm pi, so hand-ins here don't count"
            : record !== null && !isTopLevel(record)
              ? `This session: ${session}, started from inside another Pi, so hand-ins here don't count toward done`
              : `This session: ${session}, ${stale === null ? "a fresh conversation" : `not fresh: it ${stale}`}`
        );
        const open = openTask(events, session);
        out(
          open === null
            ? "Its task:     none yet"
            : `Its task:     ${open.task.taskId}, ${open.accepted ? "accepted" : "open"}`
        );
        const bySession = new Map<string, string[]>();
        for (const event of events) {
          if (event._tag !== "Submitted") {
            continue;
          }
          const key = event.session ?? "(outside pnpm pi)";
          const list = bySession.get(key) ?? [];
          list.push(
            event.verdict === "accepted"
              ? "accepted"
              : event.verdict === "rule"
                ? "rejected (house rule)"
                : "rejected (missing details)"
          );
          bySession.set(key, list);
        }
        if (bySession.size === 0) {
          out("Hand-ins:     none");
        } else {
          out("Hand-ins:");
          for (const [key, list] of bySession) {
            const theirs = sessions.find((s) => s.session === key) ?? null;
            const note = key.startsWith("(")
              ? ""
              : theirs === null
                ? " (no launcher record)"
                : !isTopLevel(theirs)
                  ? " (nested, not counted)"
                  : notFresh(theirs, sessions) === null
                    ? " (fresh conversation)"
                    : " (not a fresh conversation)";
            out(`  ${key}${note}: ${list.join(", ")}`);
          }
        }
        return 0;
      },

      /** The done check: PASS only when every claim holds. */
      async done(ctx) {
        const events = await readEvents(ctx.stateDir);
        const sessions = await deps.readSessions(ctx.repoRoot);
        const claims = judge(events, sessions);
        for (const claim of claims) {
          out(`${claim.ok ? "PASS" : "FAIL"}  ${claim.name}`);
          out(`      ${claim.detail}`);
        }
        for (const note of notes(events, sessions)) {
          out(note);
        }
        const ok = claims.every((c) => c.ok);
        out(
          ok
            ? "Done: a lesson carried into a fresh session, and a changed one didn't come back."
            : `Not done yet. Start over any time with ${ex(ctx, "setup")}.`
        );
        return ok ? 0 : 1;
      },
    },
  });
}
