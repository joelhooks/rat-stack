import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { exerciseContext } from "#shared/core/context.ts";
import { type SessionRecord, writeSession } from "#shared/core/sessions.ts";
import { appendTurn, type TurnLine, turnsPath } from "#shared/core/turns.ts";
import { appendEvent, type JobEvent } from "#shared/own-loop/job.ts";
import { judgeSurvive, type TurnsBySession } from "#shared/own-loop/survive.ts";

import exercise from "./exercise.ts";

// The done check's rules, as stories: what happened to the job, which Pi
// session did each thing, how each session ended, and who prompted it. None
// of them knows or cares how the agent waited.

const at = (n: number) =>
  new Date(Date.UTC(2026, 10, 10, 18, 0, n)).toISOString();

const A = "ses_a_aaaaaaaaaaaa";
const B = "ses_b_bbbbbbbbbbbb";

function session(
  id: string,
  from: number,
  to: number | null,
  ended: SessionRecord["ended"] = to === null ? null : "quit",
  parentSession: string | null = null
): SessionRecord {
  return {
    session: id,
    parentSession,
    piSessionId: "tmx-02.2-main",
    pid: 4242,
    role: "main",
    exercise: "02.2",
    startedAt: at(from),
    endedAt: to === null ? null : at(to),
    ended,
    exitCode: ended === "quit" ? 0 : ended === "error" ? 1 : null,
    exitSignal: ended === "signal" ? "SIGKILL" : null,
  };
}

const start = (n: number, by: string | null): JobEvent => ({
  _tag: "RunStarted",
  runId: "run_now",
  at: at(n),
  seeded: false,
  session: by,
});
const publish = (n: number): JobEvent => ({
  _tag: "ResultPublished",
  runId: "run_now",
  resultId: "res_now",
  stats: { lines: 2, words: 2, bytes: 9 },
  at: at(n),
  session: null,
});
const consume = (n: number, by: string | null, id = "res_now"): JobEvent => ({
  _tag: "ResultConsumed",
  resultId: id,
  at: at(n),
  session: by,
});
const seededOld: JobEvent[] = [
  { _tag: "RunStarted", runId: "run_old", at: at(0), seeded: true },
  {
    _tag: "ResultPublished",
    runId: "run_old",
    resultId: "res_old",
    stats: { lines: 2, words: 2, bytes: 9 },
    at: at(1),
  },
];

const started = (n: number): TurnLine => ({ at: at(n), kind: "start" });
const prompt = (n: number, source: string): TurnLine => ({
  at: at(n),
  kind: "prompt",
  source,
});

function check(
  events: JobEvent[],
  sessions: SessionRecord[],
  turns: Record<string, TurnLine[] | null>
) {
  return judgeWithNotes(events, sessions, turns).claims;
}
function judgeWithNotes(
  events: JobEvent[],
  sessions: SessionRecord[],
  turns: Record<string, TurnLine[] | null>
) {
  const map: TurnsBySession = new Map(Object.entries(turns));
  return judgeSurvive([...seededOld, ...events], sessions, map);
}
const verdict = (...args: Parameters<typeof check>) =>
  check(...args).map((c) => c.ok);

// A asks for the run (prompted by a person, as it should be), quits; the run
// finishes while Pi is closed; B starts and picks the result up unprompted.
const goodSessions = [session(A, 2, 10), session(B, 12, null)];
const goodTurns = {
  [A]: [started(2), prompt(3, "interactive")],
  [B]: [started(12)],
};

describe("the 02.2 done check", () => {
  it("passes when a later session picks up the result unprompted", () => {
    expect(
      verdict(
        [start(4, A), publish(11), consume(13, B)],
        goodSessions,
        goodTurns
      )
    ).toEqual([true, true, true, true, true]);
  });

  it("passes the reference: a watch restored at startup wakes B, then a person talks", () => {
    // The reference loop restores its watch on B's startup and wakes the agent with a
    // custom message: no input to Pi at all. Prompts after the consume are
    // fine. The run can also finish after B started.
    expect(
      verdict([start(4, A), publish(14), consume(15, B)], goodSessions, {
        ...goodTurns,
        [B]: [started(12), prompt(20, "interactive")],
      })
    ).toEqual([true, true, true, true, true]);
  });

  it("passes when the guest's own code sends B a user message", () => {
    expect(
      verdict([start(4, A), publish(11), consume(14, B)], goodSessions, {
        ...goodTurns,
        [B]: [started(12), prompt(13, "extension")],
      })
    ).toEqual([true, true, true, true, true]);
  });

  it("fails the naive loop: it waits and consumes in the session that started it", () => {
    const claims = check(
      [start(4, A), publish(8), consume(9, A)],
      [session(A, 2, 10)],
      goodTurns
    );
    expect(claims.map((c) => c.ok)).toEqual([true, false, false, false, true]);
    expect(claims[1]?.detail).toMatch(/after the run finished/);
    expect(claims[2]?.detail).toMatch(/the session that started the run/);
  });

  it("fails when a person relaunches Pi and asks", () => {
    for (const source of ["interactive", "rpc", "user-bash"]) {
      const claims = check(
        [start(4, A), publish(11), consume(14, B)],
        goodSessions,
        { ...goodTurns, [B]: [started(12), prompt(13, source)] }
      );
      expect(claims.map((c) => c.ok)).toEqual([true, true, true, false, true]);
      expect(claims[3]?.detail).toMatch(/1 prompt from a person/);
    }
  });

  it("fails while A is still open, and on a crash or kill instead of a quit", () => {
    const open = check([start(4, A)], [session(A, 2, null)], goodTurns);
    expect(open[1]?.ok).toBe(false);
    for (const ended of ["signal", "error"] as const) {
      const claims = check(
        [start(4, A), publish(11), consume(13, B)],
        [session(A, 2, 10, ended), session(B, 12, null)],
        goodTurns
      );
      expect(claims.map((c) => c.ok)).toEqual([true, false, true, true, true]);
      expect(claims[1]?.detail).toMatch(/killed|exited with code/);
    }
  });

  it("fails when the run finished before A quit", () => {
    const claims = check(
      [start(4, A), publish(8), consume(13, B)],
      goodSessions,
      goodTurns
    );
    expect(claims.map((c) => c.ok)).toEqual([true, false, true, true, true]);
  });

  it("fails a second Pi that was already running before A quit", () => {
    const claims = check(
      [start(4, A), publish(11), consume(13, B)],
      [session(A, 2, 10), session(B, 3, null)],
      { ...goodTurns, [B]: [started(3)] }
    );
    expect(claims.map((c) => c.ok)).toEqual([true, true, false, true, true]);
    expect(claims[2]?.detail).toMatch(/before ses_a_\w+ quit/);
  });

  it("fails runs started or results consumed outside a recorded Pi", () => {
    const fromTerminal = check(
      [start(4, null), publish(11), consume(13, B)],
      goodSessions,
      goodTurns
    );
    expect(fromTerminal[0]?.ok).toBe(false);
    const byHand = check(
      [start(4, A), publish(11), consume(13, null)],
      goodSessions,
      goodTurns
    );
    expect(byHand.map((c) => c.ok)).toEqual([true, true, false, false, true]);
  });

  it("counts only top-level sessions: an agent's nested Pis are noted, not counted", () => {
    // The agent played the guest: it started A and B from inside the guest's
    // own Pi (G). Both quit and consume on time, and neither counts.
    const G = "ses_g_gggggggggggg";
    const nestedA = session(A, 2, 10, "quit", G);
    const nestedB = session(B, 12, null, null, G);
    const both = judgeWithNotes(
      [start(4, A), publish(11), consume(13, B)],
      [session(G, 1, null), nestedA, nestedB],
      goodTurns
    );
    expect(both.claims.map((c) => c.ok)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(both.claims[0]?.detail).toMatch(/started from inside another Pi/);
    expect(both.claims[2]?.detail).toMatch(/only from outside a top-level Pi/);
    expect(both.notes).toEqual([
      "Note: 2 nested sessions seen and not counted",
    ]);

    // The guest did it for real, after the agent tested in a nested Pi.
    const tested = judgeWithNotes(
      [
        consume(3, "ses_t_tttttttttttt", "res_old"),
        start(4, A),
        publish(11),
        consume(13, B),
      ],
      [...goodSessions, session("ses_t_tttttttttttt", 2, 3, "quit", A)],
      goodTurns
    );
    expect(tested.claims.map((c) => c.ok)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(tested.notes).toEqual([
      "Note: 1 nested session seen and not counted",
    ]);
  });

  it("notes a consume from a plain terminal, and nothing when all is top-level", () => {
    expect(
      judgeWithNotes(
        [start(4, A), publish(11), consume(12, null), consume(13, B)],
        goodSessions,
        goodTurns
      ).notes
    ).toEqual([
      "Note: 1 consume from outside a top-level Pi session not counted",
    ]);
    expect(
      judgeWithNotes(
        [start(4, A), publish(11), consume(13, B)],
        goodSessions,
        goodTurns
      ).notes
    ).toEqual([]);
  });

  it("fails a run started under the test-only window", () => {
    const claims = check(
      [
        {
          _tag: "RunStarted",
          runId: "run_now",
          at: at(4),
          seeded: false,
          session: A,
          testWindowMinutes: 0.5,
        },
        publish(11),
        consume(13, B),
      ],
      goodSessions,
      goodTurns
    );
    expect(claims.map((c) => c.ok)).toEqual([false, true, true, true, true]);
    expect(claims[0]?.detail).toMatch(
      /used the test-only window \(TMX_TEST_WITHIN_MINUTES=0\.5\); start a normal run/
    );
  });

  it("doesn't count a kill the launcher passed on as a quit, even if Pi exited 0", () => {
    const killed: SessionRecord = {
      ...session(A, 2, 10),
      ended: "signal",
      exitCode: 0,
      exitSignal: "SIGTERM",
    };
    const claims = check(
      [start(4, A), publish(11), consume(13, B)],
      [killed, session(B, 12, null)],
      goodTurns
    );
    expect(claims[1]?.ok).toBe(false);
    expect(claims[1]?.detail).toMatch(/was killed \(SIGTERM\)/);
  });

  it("fails when B has no prompt record to prove nobody asked", () => {
    expect(
      verdict([start(4, A), publish(11), consume(13, B)], goodSessions, {
        [A]: goodTurns[A],
        [B]: null,
      })[3]
    ).toBe(false);
  });

  it("fails on a double consume and on a stale result", () => {
    expect(
      verdict(
        [start(4, A), publish(11), consume(13, B), consume(14, B)],
        goodSessions,
        goodTurns
      )
    ).toEqual([true, true, false, false, true]);
    expect(
      verdict(
        [start(4, A), consume(12, B, "res_old"), publish(13), consume(14, B)],
        goodSessions,
        goodTurns
      )
    ).toEqual([true, true, true, true, false]);
  });

  it("done reads the job, the session records and the prompt notes from disk", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "tmx-02.2-")));
    try {
      const ctx = exerciseContext({
        exerciseId: "02.2",
        repoRoot: root,
        env: { TMX_STATE_DIR: join(root, "state") },
      });
      for (const event of [
        ...seededOld,
        start(4, A),
        publish(11),
        consume(13, B),
      ]) {
        await appendEvent(ctx.stateDir, event);
      }
      for (const record of goodSessions) {
        await writeSession(root, record);
      }
      appendTurn(turnsPath(root, B), started(12));
      const done = exercise.commands["done"];
      expect(await done?.(ctx, [])).toBe(0);
      appendTurn(turnsPath(root, B), prompt(12, "interactive"));
      expect(await done?.(ctx, [])).toBe(1);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
