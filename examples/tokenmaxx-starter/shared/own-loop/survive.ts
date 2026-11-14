import type { ExerciseContext } from "#shared/core/context.ts";
import {
  isTopLevel,
  plural,
  readSessions,
  type SessionRecord,
} from "#shared/core/sessions.ts";
import { humanSources, readTurns, type TurnLine } from "#shared/core/turns.ts";

import {
  type Claim,
  fold,
  freshClaim,
  ignoredConsumesNote,
  type JobEvent,
  splitConsumes,
  testWindowDetail,
  type Verdict,
} from "./job.ts";

// The 02.2 done check: the same job as 02.1, read together with the
// launcher's session records (shared/core/sessions.ts) and its note of who
// prompted each Pi (shared/core/turns.ts). It never looks at how the guest
// waited, only at which session did what, and when:
//
// 1. the current run was started from inside a Pi session, A;
// 2. A ended with a graceful quit (`ended: quit`), and before the run
//    finished. `/reload` keeps the same Pi process, so it never ends A; a
//    crash or kill ends it with `signal` or `error`, which doesn't count;
// 3. the run's result was consumed exactly once, in a session B that
//    started after A quit;
// 4. nobody prompted B before that consume: no typed prompt, `-p` or
//    command-line message, RPC prompt or `!command`. A message an extension
//    sends (`pi.sendUserMessage`, a custom message) is not a person;
// 5. no stale result was consumed, as in 02.1.
//
// A and B both have to be top-level: Pis the guest started with `pnpm pi`,
// not ones an agent started from inside its own Pi to test its work. Only
// consumes made in a top-level session count. What the check saw and didn't
// count goes in a neutral note.
//
// Known gap: typing an extension's slash command in B (for example a
// "resume" command) isn't an input to Pi, so the note doesn't see it.

export type TurnsBySession = ReadonlyMap<string, readonly TurnLine[] | null>;

/** Reads the records `judgeSurvive` needs and judges. */
export async function judgeSurviveFrom(
  ctx: ExerciseContext,
  events: readonly JobEvent[]
): Promise<Verdict> {
  const sessions = await readSessions(ctx.repoRoot);
  const turns = new Map<string, TurnLine[] | null>();
  for (const record of sessions) {
    turns.set(record.session, await readTurns(ctx.repoRoot, record.session));
  }
  return judgeSurvive(events, sessions, turns);
}

const ms = (iso: string) => Date.parse(iso);
const clock = (iso: string) => iso.slice(11, 19);

function describeEnd(record: SessionRecord): string {
  if (record.ended === "signal") {
    return `was killed (${record.exitSignal ?? "a signal"})`;
  }
  if (record.ended === "error") {
    return `exited with code ${record.exitCode ?? "?"}`;
  }
  return "is still open";
}

export function judgeSurvive(
  events: readonly JobEvent[],
  sessions: readonly SessionRecord[],
  turns: TurnsBySession
): Verdict {
  const state = fold(events);
  const { current } = state;
  const byId = new Map(sessions.map((s) => [s.session, s]));
  const starter =
    current?.session == null ? null : (byId.get(current.session) ?? null);
  const a = starter !== null && isTopLevel(starter) ? starter : null;
  const result = current?.result ?? null;
  const { counted, ignored } = splitConsumes(state.consumed, sessions);

  const startedName = "the current run was started in a Pi session";
  const started: Claim =
    current === null
      ? { ok: false, name: startedName, detail: "no run yet" }
      : current.session === null
        ? {
            ok: false,
            name: startedName,
            detail: `${current.runId} was started outside any Pi started with pnpm pi`,
          }
        : starter === null
          ? {
              ok: false,
              name: startedName,
              detail: `${current.runId} was started in ${current.session}, which has no session record`,
            }
          : a === null
            ? {
                ok: false,
                name: startedName,
                detail: `${current.runId} was started in ${starter.session}, a Pi started from inside another Pi. Start the run from a Pi you started with pnpm pi`,
              }
            : current.testWindow !== null
              ? {
                  ok: false,
                  name: startedName,
                  detail: testWindowDetail(current.runId, current.testWindow),
                }
              : {
                  ok: true,
                  name: startedName,
                  detail: `${current.runId} started in ${a.session}`,
                };

  const quitName = "that session quit before the run finished";
  const quit: Claim = (() => {
    if (a === null) {
      return { ok: false, name: quitName, detail: "no session to check yet" };
    }
    if (a.ended !== "quit" || a.endedAt === null) {
      return {
        ok: false,
        name: quitName,
        detail: `${a.session} ${describeEnd(a)}; it has to quit (/quit or Ctrl+D)`,
      };
    }
    if (result === null) {
      return {
        ok: false,
        name: quitName,
        detail: `${a.session} quit at ${clock(a.endedAt)}; the run is still running`,
      };
    }
    if (ms(a.endedAt) > ms(result.at)) {
      return {
        ok: false,
        name: quitName,
        detail: `${a.session} quit at ${clock(a.endedAt)}, after the run finished at ${clock(result.at)}`,
      };
    }
    return {
      ok: true,
      name: quitName,
      detail: `${a.session} quit at ${clock(a.endedAt)}; the run finished at ${clock(result.at)}`,
    };
  })();

  const takes =
    result === null
      ? []
      : counted.filter((c) => c.resultId === result.resultId);
  const elsewhere =
    result === null
      ? 0
      : ignored.filter((c) => c.resultId === result.resultId).length;
  const take = takes.length === 1 ? (takes[0] ?? null) : null;
  const b = take?.session == null ? null : (byId.get(take.session) ?? null);

  const laterName = "its result was consumed exactly once, in a later session";
  const later: Claim = (() => {
    if (result === null) {
      return { ok: false, name: laterName, detail: "nothing to consume yet" };
    }
    if (take === null) {
      return {
        ok: false,
        name: laterName,
        detail:
          takes.length === 0 && elsewhere > 0
            ? `${result.resultId} was consumed only from outside a top-level Pi session`
            : `${result.resultId} consumed ${plural(takes.length, "time")}`,
      };
    }
    if (a !== null && take.session === a.session) {
      return {
        ok: false,
        name: laterName,
        detail: `${result.resultId} was consumed in ${a.session}, the session that started the run`,
      };
    }
    if (b === null) {
      return {
        ok: false,
        name: laterName,
        detail: `${result.resultId} was consumed in ${take.session ?? "no session"}, which has no session record`,
      };
    }
    if (a?.endedAt == null || ms(b.startedAt) < ms(a.endedAt)) {
      return {
        ok: false,
        name: laterName,
        detail: `${result.resultId} was consumed in ${b.session}, which started at ${clock(b.startedAt)}, before ${a?.session ?? "the starting session"} quit`,
      };
    }
    return {
      ok: true,
      name: laterName,
      detail: `${result.resultId} consumed once, in ${b.session}, started at ${clock(b.startedAt)}`,
    };
  })();

  const askedName = "nobody prompted that session before the consume";
  const asked: Claim = (() => {
    if (take === null || b === null) {
      return {
        ok: false,
        name: askedName,
        detail: "no consume in a later session to check yet",
      };
    }
    const lines = turns.get(b.session) ?? null;
    if (lines === null) {
      return {
        ok: false,
        name: askedName,
        detail: `${b.session} has no prompt record; start Pi with pnpm pi`,
      };
    }
    const prompts = lines.filter(
      (line) =>
        line.kind === "prompt" &&
        humanSources.includes(line.source) &&
        ms(line.at) <= ms(take.at)
    );
    if (prompts.length > 0) {
      const first = prompts[0];
      return {
        ok: false,
        name: askedName,
        detail: `${b.session} got ${prompts.length} prompt${prompts.length === 1 ? "" : "s"} from a person before the consume, the first at ${first === undefined ? "?" : clock(first.at)}`,
      };
    }
    return {
      ok: true,
      name: askedName,
      detail: `no typed or command-line prompt reached ${b.session} before ${clock(take.at)}`,
    };
  })();

  return {
    claims: [started, quit, later, asked, freshClaim(counted)],
    notes: survivalNotes(events, byId, ignored.length),
  };
}

/**
 * "Note: 2 nested sessions seen and not counted": the Pis started from inside
 * another Pi that started, finished or consumed a run. Then any other consume
 * the check ignored (a plain terminal, a session with no record).
 */
function survivalNotes(
  events: readonly JobEvent[],
  byId: ReadonlyMap<string, SessionRecord>,
  ignoredConsumes: number
): readonly string[] {
  const nested = new Set<string>();
  let nestedConsumes = 0;
  for (const event of events) {
    const record = event.session == null ? undefined : byId.get(event.session);
    if (record !== undefined && !isTopLevel(record)) {
      nested.add(record.session);
      if (event._tag === "ResultConsumed") {
        nestedConsumes += 1;
      }
    }
  }
  return [
    ...(nested.size === 0
      ? []
      : [
          `Note: ${plural(nested.size, "nested session")} seen and not counted`,
        ]),
    ...ignoredConsumesNote(ignoredConsumes - nestedConsumes),
  ];
}
