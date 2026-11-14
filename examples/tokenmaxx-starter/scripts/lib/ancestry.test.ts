import { describe, expect, it } from "vitest";

import type { SessionRecord } from "#shared/core/sessions.ts";

import { findLiveAncestor, systemAncestry, walkAncestors } from "./ancestry.ts";

const parents = (table: Record<number, number>) => (pid: number) =>
  table[pid] ?? null;

describe("walkAncestors", () => {
  it("follows parents nearest first and stops at PID 1", () => {
    expect(walkAncestors(40, parents({ 40: 30, 30: 20, 20: 1 }))).toEqual([
      40, 30, 20,
    ]);
    expect(walkAncestors(40, parents({ 40: 0 }))).toEqual([40]);
  });

  it("stops at a loop instead of spinning", () => {
    expect(walkAncestors(40, parents({ 40: 30, 30: 20, 20: 40 }))).toEqual([
      40, 30, 20,
    ]);
    expect(walkAncestors(40, parents({ 40: 40 }))).toEqual([40]);
  });

  it("stops at a bounded depth on a runaway chain", () => {
    const chain = walkAncestors(10_000, (pid) => pid - 1);
    expect(chain?.length).toBe(128);
  });

  it("returns null when not even the first parent can be read", () => {
    expect(walkAncestors(40, () => null)).toBeNull();
    // A process that exits mid-walk keeps what was read so far.
    expect(walkAncestors(40, parents({ 40: 30 }))).toEqual([40, 30]);
  });

  it("reads this process's real tree", () => {
    // /proc on Linux, ps on macOS: both are there wherever this suite runs.
    const chain = systemAncestry.ancestors();
    expect(chain?.[0]).toBe(process.ppid);
    expect(chain).not.toContain(1);
  });
});

describe("findLiveAncestor", () => {
  const record = (over: Partial<SessionRecord>): SessionRecord => ({
    session: "ses_a_000000000000",
    parentSession: null,
    piSessionId: "tmx-main",
    pid: 300,
    launcherPid: 299,
    role: "main",
    exercise: null,
    startedAt: "2026-11-11T04:51:29.000Z",
    endedAt: null,
    ended: null,
    exitCode: null,
    exitSignal: null,
    ...over,
  });

  it("picks the nearest Pi as parent and the outermost launcher as the guest", () => {
    const guest = record({});
    const nested = record({
      session: "ses_b_000000000000",
      parentSession: guest.session,
      pid: 450,
      launcherPid: 449,
    });
    const found = findLiveAncestor(
      [501, 500, 450, 449, 401, 400, 300, 299, 12],
      [guest, nested],
      () => true
    );
    expect(found?.parent.session).toBe(nested.session);
    expect(found?.guestPid).toBe(299);
  });

  it("uses the next PID up as the launcher for an older record", () => {
    const { launcherPid: _, ...old } = record({});
    const found = findLiveAncestor([400, 300, 299], [old], () => true);
    expect(found?.guestPid).toBe(299);
  });

  it("finds nothing outside a recorded Pi", () => {
    expect(findLiveAncestor([], [record({})], () => true)).toBeNull();
    expect(findLiveAncestor([400, 12], [record({})], () => true)).toBeNull();
  });
});
