import {
  isTopLevel,
  plural,
  type SessionRecord,
} from "#shared/core/sessions.ts";

import { type MemoryEvent, ruleSets, type Submitted } from "./log.ts";

// The 03.1 done check. It reads only the event log and the launcher's
// session records, never the guest's code or memory:
//
// 1. some session A broke the first house rule, was told why, then passed;
// 2. a fresh session B, started after A was told, passed on its first try;
// 3. the house rule changed after that;
// 4. a fresh session C, started after the change, followed the new rule on
//    its first try and never wrote the old form.
//
// "Fresh" means a Pi conversation no earlier session had: `pnpm pi` without
// `--fresh` resumes the last one, and a resumed transcript isn't memory.
//
// A, B and C all have to be top-level: Pis the guest started with `pnpm pi`,
// not ones an agent started from inside its own Pi to test its work. Hand-ins
// from nested sessions are left out and noted.

export type SessionFacts = Pick<
  SessionRecord,
  "session" | "parentSession" | "piSessionId" | "startedAt"
>;

export type Claim = {
  readonly ok: boolean;
  readonly name: string;
  readonly detail: string;
};

export const claimNames = {
  a: "a session broke the house rule, was told why, then passed",
  b: "a fresh session passed on its first try",
  change: "the house rule changed after that",
  c: "a fresh session after the change followed the new rule on its first try",
} as const;

type Run = {
  readonly session: string;
  readonly attempts: readonly Submitted[];
  readonly record: SessionFacts | null;
};

const time = (iso: string) => `${iso.slice(11, 19)} UTC`;

/** Why `record`'s session is not a fresh Pi conversation, or null when it is. */
export function notFresh(
  record: SessionFacts | null,
  all: readonly SessionFacts[]
): string | null {
  if (record === null) {
    return "has no launcher record: start Pi with pnpm pi";
  }
  if (record.piSessionId === null) {
    return "picked its Pi conversation with a session flag, so it can't be shown to be new";
  }
  const earlier = all.find(
    (other) =>
      other.session !== record.session &&
      other.piSessionId === record.piSessionId &&
      (other.startedAt < record.startedAt ||
        (other.startedAt === record.startedAt &&
          other.session < record.session))
  );
  return earlier === undefined
    ? null
    : `resumed the Pi conversation ${earlier.session} had, so it read the old transcript, not a memory. Start it with --fresh`;
}

function runsOf(
  events: readonly MemoryEvent[],
  sessions: readonly SessionFacts[]
): Run[] {
  const attempts = new Map<string, Submitted[]>();
  for (const event of events) {
    if (event._tag === "Submitted" && event.session !== null) {
      const list = attempts.get(event.session) ?? [];
      list.push(event);
      attempts.set(event.session, list);
    }
  }
  return [...attempts]
    .map(([session, list]) => ({
      session,
      attempts: list,
      record: sessions.find((s) => s.session === session) ?? null,
    }))
    .filter((run) => run.record === null || isTopLevel(run.record));
}

/** "Note: 2 nested sessions seen and not counted", when there were any. */
export function notes(
  events: readonly MemoryEvent[],
  sessions: readonly SessionFacts[]
): readonly string[] {
  const nested = new Set<string>();
  for (const event of events) {
    if (event._tag !== "Submitted" || event.session === null) {
      continue;
    }
    const record = sessions.find((s) => s.session === event.session);
    if (record !== undefined && !isTopLevel(record)) {
      nested.add(record.session);
    }
  }
  return nested.size === 0
    ? []
    : [`Note: ${plural(nested.size, "nested session")} seen and not counted`];
}

const fail = (name: string, detail: string): Claim => ({
  ok: false,
  name,
  detail,
});
const pass = (name: string, detail: string): Claim => ({
  ok: true,
  name,
  detail,
});

export function judge(
  events: readonly MemoryEvent[],
  sessions: readonly SessionFacts[]
): readonly Claim[] {
  const rules = ruleSets(events);
  if (rules.length === 0) {
    const setup = "no house rule yet: run pnpm ex 03.1 setup";
    return Object.values(claimNames).map((name) => fail(name, setup));
  }
  const runs = runsOf(events, sessions);
  const outside = events.filter(
    (e) => e._tag === "Submitted" && e.session === null
  ).length;
  const outsideNote =
    outside === 0
      ? ""
      : ` (${outside} hand-in${outside === 1 ? "" : "s"} came from outside a pnpm pi session and don't count)`;

  // 1. A: broke the first rule, then passed under it.
  let a: { session: string; brokeAt: string; passedAt: string } | null = null;
  for (const run of runs) {
    const first = run.attempts.filter((s) => s.ruleVersion === 1);
    const broke = first.findIndex((s) => s.verdict === "rule");
    const passed = first.slice(broke + 1).find((s) => s.verdict === "accepted");
    if (broke !== -1 && passed !== undefined) {
      a = {
        session: run.session,
        brokeAt: first[broke]?.at ?? "",
        passedAt: passed.at,
      };
      break;
    }
  }
  const aClaim: Claim =
    a !== null
      ? pass(
          claimNames.a,
          `${a.session} was rejected at ${time(a.brokeAt)} with the reason, and passed at ${time(a.passedAt)}`
        )
      : fail(claimNames.a, describeNoA(runs) + outsideNote);

  // 2. B: fresh, started after A was told why, first try accepted.
  let b: { session: string; at: string } | null = null;
  let bWhy = "";
  if (a !== null) {
    const aRun = a;
    const candidates = runs.filter(
      (run) =>
        run.session !== aRun.session && run.attempts[0]?.ruleVersion === 1
    );
    for (const run of candidates) {
      const why = bProblem(run, aRun.brokeAt, sessions);
      if (why === null) {
        b = { session: run.session, at: run.attempts[0]?.at ?? "" };
        break;
      }
      bWhy = `${run.session} ${why}`;
    }
    if (candidates.length === 0) {
      bWhy = `no other session has handed in under the first rule yet${outsideNote}`;
    }
  }
  const bClaim: Claim =
    b !== null
      ? pass(
          claimNames.b,
          `${b.session} passed at ${time(b.at)} without being told the rule in that session`
        )
      : fail(claimNames.b, a === null ? "needs the line above first" : bWhy);

  // 3. The rule changed after B.
  const last = rules.at(-1) ?? rules[0];
  const changed = b !== null && last !== undefined && last.version > 1;
  const changeClaim: Claim = changed
    ? pass(
        claimNames.change,
        `version ${last.version} has been in force since ${time(last.at)}`
      )
    : fail(
        claimNames.change,
        rules.length > 1
          ? "the rule changed before a fresh session passed under the first one. Run pnpm ex 03.1 setup to start over"
          : b === null
            ? "needs the line above first, then pnpm ex 03.1 change-rule"
            : "not yet: run pnpm ex 03.1 change-rule"
      );

  // 4. C: started after the change, fresh, first try follows the new rule,
  // never the old form.
  let cClaim: Claim = fail(claimNames.c, "needs the line above first");
  if (changed) {
    const changeAt = last.at;
    // A session started after the change only ever saw the new rule.
    const late = runs.filter(
      (run) =>
        run.attempts.some((s) => s.ruleVersion === last.version) &&
        (run.record === null || run.record.startedAt <= changeAt)
    );
    const candidates = runs.filter(
      (run) => run.record !== null && run.record.startedAt > changeAt
    );
    let why =
      candidates.length === 0
        ? `no session started since the change has handed in yet${
            late.length === 0
              ? ""
              : `; ${late.map((r) => r.session).join(", ")} started before it, so ${late.length === 1 ? "it doesn't" : "they don't"} count`
          }${outsideNote}`
        : "";
    let c: Run | null = null;
    for (const run of candidates) {
      const problem = cProblem(run, sessions);
      if (problem === null) {
        c = run;
        break;
      }
      why = `${run.session} ${problem}`;
    }
    cClaim =
      c !== null
        ? pass(
            claimNames.c,
            `${c.session} passed at ${time(c.attempts[0]?.at ?? "")} and never wrote the old form`
          )
        : fail(claimNames.c, why);
  }

  return [aClaim, bClaim, changeClaim, cClaim];
}

function describeNoA(runs: readonly Run[]): string {
  if (runs.length === 0) {
    return "nothing handed in from a Pi session yet";
  }
  const brokeOnly = runs.find((run) =>
    run.attempts.some((s) => s.ruleVersion === 1 && s.verdict === "rule")
  );
  if (brokeOnly !== undefined) {
    return `${brokeOnly.session} broke the rule but hasn't passed since`;
  }
  const lucky = runs.find(
    (run) =>
      run.attempts[0]?.ruleVersion === 1 &&
      run.attempts[0]?.verdict === "accepted"
  );
  if (lucky !== undefined) {
    return `${lucky.session} passed without breaking the rule, so there was no mistake to learn from. Run pnpm ex 03.1 setup for a new rule`;
  }
  return "no session has broken the house rule yet";
}

function bProblem(
  run: Run,
  toldAt: string,
  sessions: readonly SessionFacts[]
): string | null {
  const stale = notFresh(run.record, sessions);
  if (stale !== null) {
    return stale;
  }
  if (run.record !== null && run.record.startedAt <= toldAt) {
    return "started before the first session was told the rule, so it couldn't have learned it";
  }
  const first = run.attempts[0];
  if (first?.verdict === "rule") {
    return "broke the house rule on its first try";
  }
  if (first?.verdict === "content") {
    return "left out the service, the release or the person on its first try";
  }
  return null;
}

function cProblem(run: Run, sessions: readonly SessionFacts[]): string | null {
  const stale = notFresh(run.record, sessions);
  if (stale !== null) {
    return stale;
  }
  const first = run.attempts[0];
  if (first?.usedRetired === true) {
    return "wrote the person the old way on its first try: its memory still holds the lesson that changed";
  }
  if (first?.verdict === "rule") {
    return "didn't follow the new rule on its first try";
  }
  if (first?.verdict === "content") {
    return "left out the service, the release or the person on its first try";
  }
  if (run.attempts.some((s) => s.usedRetired)) {
    return "wrote the person the old way on a later try";
  }
  return null;
}
