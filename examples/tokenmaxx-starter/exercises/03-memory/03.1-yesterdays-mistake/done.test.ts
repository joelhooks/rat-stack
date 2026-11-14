import { describe, expect, it } from "vitest";

import { type SessionFacts, judge, notes } from "#shared/memory/judge.ts";
import type { MemoryEvent, Verdict } from "#shared/memory/log.ts";

// The done check's own rules, as stories: given what each session handed in
// and how it was launched, which claims pass. None of them knows or cares
// how the guest remembers.

const at = (n: number) =>
  new Date(Date.UTC(2026, 10, 10, 18, 0, n)).toISOString();

const rule = (version: number, n: number): MemoryEvent => ({
  _tag: "RuleSet",
  version,
  salt: "00",
  seal: "00",
  at: at(n),
  session: null,
});

const hand = (
  session: string | null,
  n: number,
  verdict: Verdict,
  opts: { version?: number; usedRetired?: boolean } = {}
): MemoryEvent => ({
  _tag: "Submitted",
  taskId: `tsk_${n}`,
  ruleVersion: opts.version ?? 1,
  verdict,
  usedRetired: opts.usedRetired ?? false,
  at: at(n),
  session,
});

/**
 * A launcher record: started at second `n`, in Pi conversation `pi`, from a
 * terminal, or from inside the Pi session `parent`.
 */
const ses = (
  session: string,
  n: number,
  pi: string | null,
  parent: string | null = null
): SessionFacts => ({
  session,
  parentSession: parent,
  piSessionId: pi,
  startedAt: at(n),
});

const verdict = (events: MemoryEvent[], sessions: SessionFacts[]) =>
  judge(events, sessions).map((c) => c.ok);
const detail = (events: MemoryEvent[], sessions: SessionFacts[], i: number) =>
  judge(events, sessions)[i]?.detail ?? "";

// The story that passes: A learns, B remembers, the rule changes, C follows
// the new one.
const A = [hand("A", 2, "rule"), hand("A", 3, "accepted")];
const B = [hand("B", 6, "accepted")];
const C = [hand("C", 12, "accepted", { version: 2 })];
const sessions = [
  ses("A", 1, "tmx-03.1-main"),
  ses("B", 5, "tmx-03.1-main-20261110T180005"),
  ses("C", 11, "tmx-03.1-main-20261110T180011"),
];
const passing = [rule(1, 0), ...A, ...B, rule(2, 10), ...C];

describe("the 03.1 done check", () => {
  it("passes when a lesson carries over and a changed one doesn't come back", () => {
    expect(verdict(passing, sessions)).toEqual([true, true, true, true]);
  });

  it("fails with no memory: the fresh session repeats the mistake", () => {
    const events = [rule(1, 0), ...A, hand("B", 6, "rule")];
    expect(verdict(events, sessions)).toEqual([true, false, false, false]);
    expect(detail(events, sessions, 1)).toMatch(
      /B broke the house rule on its first try/
    );
  });

  it("fails when B resumed A's conversation: a transcript isn't a memory", () => {
    const resumed = [
      ses("A", 1, "tmx-03.1-main"),
      ses("B", 5, "tmx-03.1-main"),
    ];
    const events = [rule(1, 0), ...A, ...B];
    expect(verdict(events, resumed)[1]).toBe(false);
    expect(detail(events, resumed, 1)).toMatch(
      /resumed the Pi conversation A had/
    );
  });

  it("fails when C applies the old lesson: memory repeated what changed", () => {
    const events = [
      rule(1, 0),
      ...A,
      ...B,
      rule(2, 10),
      hand("C", 12, "rule", { version: 2, usedRetired: true }),
      hand("C", 13, "accepted", { version: 2 }),
    ];
    expect(verdict(events, sessions)).toEqual([true, true, true, false]);
    expect(detail(events, sessions, 3)).toMatch(
      /old way on its first try: its memory still holds the lesson that changed/
    );
  });

  it("fails when C writes both forms, or the old one later", () => {
    const later = [
      rule(1, 0),
      ...A,
      ...B,
      rule(2, 10),
      hand("C", 12, "accepted", { version: 2 }),
      hand("C", 13, "rule", { version: 2, usedRetired: true }),
    ];
    expect(verdict(later, sessions)[3]).toBe(false);
    expect(detail(later, sessions, 3)).toMatch(/old way on a later try/);
  });

  it("fails when C forgot everything: it didn't follow the new rule", () => {
    const events = [
      rule(1, 0),
      ...A,
      ...B,
      rule(2, 10),
      hand("C", 12, "rule", { version: 2 }),
    ];
    expect(detail(events, sessions, 3)).toMatch(
      /didn't follow the new rule on its first try/
    );
  });

  it("doesn't count the session that ran change-rule, or any started before it", () => {
    const events = [
      rule(1, 0),
      ...A,
      ...B,
      rule(2, 10),
      hand("B", 12, "accepted", { version: 2 }),
    ];
    const bLate = [ses("A", 1, "a"), ses("B", 5, "b")];
    expect(verdict(events, bLate)[3]).toBe(false);
    expect(detail(events, bLate, 3)).toMatch(/B started before it/);
  });

  it("lets a later fresh session pass after the guest fixes their memory", () => {
    const events = [
      rule(1, 0),
      ...A,
      ...B,
      rule(2, 10),
      hand("C", 12, "rule", { version: 2, usedRetired: true }),
      hand("D", 15, "accepted", { version: 2 }),
    ];
    const withD = [...sessions, ses("D", 14, "tmx-03.1-main-20261110T180014")];
    expect(verdict(events, withD)).toEqual([true, true, true, true]);
  });

  it("needs B to start after A was told the rule", () => {
    const early = [ses("A", 1, "a"), ses("B", 1, "b")];
    const events = [rule(1, 0), ...A, hand("B", 6, "accepted")];
    expect(detail(events, early, 1)).toMatch(
      /started before the first session was told/
    );
  });

  it("needs a mistake first: a lucky first pass leaves nothing to learn", () => {
    const events = [rule(1, 0), hand("A", 2, "accepted")];
    expect(verdict(events, sessions)[0]).toBe(false);
    expect(detail(events, sessions, 0)).toMatch(/no mistake to learn from/);
  });

  it("ignores hand-ins from outside a pnpm pi session, and says so", () => {
    const events = [
      rule(1, 0),
      hand(null, 2, "rule"),
      hand(null, 3, "accepted"),
    ];
    expect(verdict(events, sessions)[0]).toBe(false);
    expect(detail(events, sessions, 0)).toMatch(/2 hand-ins came from outside/);
  });

  it("counts only top-level sessions: an agent's nested Pis are noted, not counted", () => {
    // The agent did it all itself: B and C are fresh Pis it started from
    // inside A, the guest's session.
    const nested = [
      ses("A", 1, "tmx-03.1-main"),
      ses("B", 5, "tmx-03.1-main-b", "A"),
      ses("C", 11, "tmx-03.1-main-c", "A"),
    ];
    expect(verdict(passing, nested)).toEqual([true, false, false, false]);
    expect(detail(passing, nested, 1)).toMatch(
      /no other session has handed in/
    );
    expect(notes(passing, nested)).toEqual([
      "Note: 2 nested sessions seen and not counted",
    ]);
    expect(notes(passing, sessions)).toEqual([]);

    // The agent tests in nested Pis, and the guest starts B and C too.
    const both = [
      ...sessions,
      ses("nB", 5, "tmx-03.1-main-nb", "A"),
      ses("nC", 11, "tmx-03.1-main-nc", "A"),
    ];
    const events = [
      rule(1, 0),
      ...A,
      hand("nB", 5, "accepted"),
      ...B,
      rule(2, 10),
      hand("nC", 11, "rule", { version: 2, usedRetired: true }),
      ...C,
    ];
    expect(verdict(events, both)).toEqual([true, true, true, true]);
  });

  it("asks for a fresh start when the rule changed before B passed", () => {
    const events = [
      rule(1, 0),
      ...A,
      rule(2, 4),
      hand("B", 6, "accepted", { version: 2 }),
    ];
    expect(verdict(events, sessions)).toEqual([true, false, false, false]);
    expect(detail(events, sessions, 2)).toMatch(/setup to start over/);
  });

  it("fails every line before setup", () => {
    expect(verdict([], [])).toEqual([false, false, false, false]);
  });
});
