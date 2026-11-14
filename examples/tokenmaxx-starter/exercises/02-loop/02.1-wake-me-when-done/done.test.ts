import { describe, expect, it } from "vitest";

import type { SessionRecord } from "#shared/core/sessions.ts";
import { type JobEvent, judge } from "#shared/own-loop/job.ts";

// The done check's own rules, as stories: given what happened to the job,
// and which Pi session consumed it, which claims pass. None of them knows or
// cares how the agent waited. Only a consume made in a top-level Pi (one the
// guest started with pnpm pi) counts.

const at = (n: number) =>
  new Date(Date.UTC(2026, 10, 10, 18, 0, n)).toISOString();
const start = (runId: string, n: number, seeded = false): JobEvent => ({
  _tag: "RunStarted",
  runId,
  at: at(n),
  seeded,
});
const publish = (runId: string, n: number): JobEvent => ({
  _tag: "ResultPublished",
  runId,
  resultId: `res_${runId}`,
  stats: { lines: 2, words: 2, bytes: 9 },
  at: at(n),
});
const GUEST = "ses_g_aaaaaaaaaaaa";
const NESTED = "ses_n_bbbbbbbbbbbb";
const record = (
  session: string,
  parentSession: string | null
): SessionRecord => ({
  session,
  parentSession,
  piSessionId: `tmx-02.1-${session}`,
  pid: 4242,
  role: "main",
  exercise: "02.1",
  startedAt: at(0),
  endedAt: null,
  ended: null,
  exitCode: null,
  exitSignal: null,
});
const sessions = [record(GUEST, null), record(NESTED, GUEST)];
const consume = (
  runId: string,
  n: number,
  by: string | null = GUEST
): JobEvent => ({
  _tag: "ResultConsumed",
  resultId: `res_${runId}`,
  at: at(n),
  session: by,
});
const seededOld = [start("old", 0, true), publish("old", 1)];
const verdict = (events: JobEvent[]) =>
  judge(events, sessions).claims.map((c) => c.ok);

describe("the 02.1 done check", () => {
  it("passes when the current run's result is consumed once", () => {
    expect(
      verdict([...seededOld, start("a", 2), publish("a", 3), consume("a", 4)])
    ).toEqual([true, true, true]);
  });

  it("fails while the current run is still running", () => {
    expect(verdict([...seededOld, start("a", 2)])).toEqual([
      false,
      false,
      true,
    ]);
  });

  it("fails when the result is never consumed, or consumed twice", () => {
    const finished = [...seededOld, start("a", 2), publish("a", 3)];
    expect(verdict(finished)[1]).toBe(false);
    expect(verdict([...finished, consume("a", 4), consume("a", 5)])).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("fails on the result setup left behind, before or after start", () => {
    const early = [...seededOld, consume("old", 2), start("a", 3)];
    expect(verdict([...early, publish("a", 4), consume("a", 5)])).toEqual([
      true,
      true,
      false,
    ]);
    const late = [...seededOld, start("a", 2), consume("old", 3)];
    expect(verdict([...late, publish("a", 4), consume("a", 5)])[2]).toBe(false);
  });

  it("fails on a superseded run that finishes late", () => {
    expect(
      verdict([
        ...seededOld,
        start("a", 2),
        start("b", 3),
        publish("a", 4),
        consume("a", 5),
        publish("b", 6),
        consume("b", 7),
      ])
    ).toEqual([true, true, false]);
  });

  it("doesn't count a consume from a plain terminal or a nested Pi, and says so", () => {
    const finished = [...seededOld, start("a", 2), publish("a", 3)];
    for (const by of [null, NESTED, "ses_x_cccccccccccc"]) {
      const { claims, notes } = judge(
        [...finished, consume("a", 4, by)],
        sessions
      );
      expect(claims.map((c) => c.ok)).toEqual([true, false, true]);
      expect(claims[1]?.detail).toMatch(/only from outside a top-level Pi/);
      expect(notes).toEqual([
        "Note: 1 consume from outside a top-level Pi session not counted",
      ]);
    }
  });

  it("passes when the agent also tested in a nested Pi, with a note", () => {
    const { claims, notes } = judge(
      [
        ...seededOld,
        start("t", 2),
        publish("t", 3),
        consume("t", 4, NESTED),
        consume("old", 5, NESTED),
        start("a", 6),
        publish("a", 7),
        consume("a", 8),
      ],
      sessions
    );
    expect(claims.map((c) => c.ok)).toEqual([true, true, true]);
    expect(notes).toEqual([
      "Note: 2 consumes from outside a top-level Pi session not counted",
    ]);
    expect(judge([...seededOld], sessions).notes).toEqual([]);
  });

  it("fails a run started under the test-only window, however it was consumed", () => {
    const { claims } = judge(
      [
        ...seededOld,
        {
          _tag: "RunStarted",
          runId: "a",
          at: at(2),
          seeded: false,
          testWindowMinutes: 0.5,
        },
        publish("a", 3),
        consume("a", 4),
      ],
      sessions
    );
    expect(claims.map((c) => c.ok)).toEqual([false, true, true]);
    expect(claims[0]?.detail).toBe(
      "a used the test-only window (TMX_TEST_WITHIN_MINUTES=0.5); start a normal run"
    );
  });

  it("allows an earlier run's result consumed while it was current", () => {
    expect(
      verdict([
        ...seededOld,
        start("a", 2),
        publish("a", 3),
        consume("a", 4),
        start("b", 5),
        publish("b", 6),
        consume("b", 7),
      ])
    ).toEqual([true, true, true]);
  });
});
