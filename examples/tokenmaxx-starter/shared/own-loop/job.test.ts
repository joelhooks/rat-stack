import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Schema } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { stepStartPath } from "#shared/core/commit-line.ts";
import { exerciseContext, findRepoRoot } from "#shared/core/context.ts";
import { pidAlive, type SessionRecord } from "#shared/core/sessions.ts";
import { readJson } from "#shared/core/store.ts";

import { ownLoopExercise } from "./exercise.ts";
import {
  appendEvent,
  fold,
  minFinishMs,
  pickDelay,
  publish,
  readEvents,
  readLatestResult,
  spawnFinisher,
  startRun,
} from "./job.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-own-loop-")));
afterAll(() => rmSync(scratch, { recursive: true }));

/** A Pi the guest started with pnpm pi: the only kind whose consume counts. */
const TOP = "ses_top_aaaaaaaaaaaa";
const NESTED = "ses_nst_bbbbbbbbbbbb";
const record = (session: string, parent: string | null): SessionRecord => ({
  session,
  parentSession: parent,
  piSessionId: null,
  pid: 4242,
  role: "main",
  exercise: "02.1",
  startedAt: "2026-11-10T18:00:00.000Z",
  endedAt: null,
  ended: null,
  exitCode: null,
  exitSignal: null,
});

function harness(name: string, id = "02.1") {
  const out: string[] = [];
  const spawned: { runId: string; maxMs: number; minMs?: number }[] = [];
  const who: { session: string | null; within?: string; committed: boolean } = {
    session: TOP,
    committed: true,
  };
  const ctx = exerciseContext({
    exerciseId: id,
    repoRoot: findRepoRoot(),
    env: { TMX_STATE_DIR: join(scratch, name) },
  });
  const exercise = ownLoopExercise(
    { id, title: "t", catchUp: id === "02.1" },
    {
      spawnFinisher: (_root, _state, runId, maxMs, minMs) => {
        spawned.push(
          minMs === undefined ? { runId, maxMs } : { runId, maxMs, minMs }
        );
        return null;
      },
      out: (line) => out.push(line),
      err: (line) => out.push(line),
      now: () => new Date(),
      session: () => who.session,
      testWithin: () => who.within,
      readSessions: () =>
        Promise.resolve([record(TOP, null), record(NESTED, TOP)]),
      commit: async () => ({
        name: "committed",
        ok: who.committed,
        detail: "",
        ...(who.committed ? {} : { fix: "commit it, then run this again." }),
      }),
    }
  );
  const run = async (command: string, ...args: string[]) => {
    out.length = 0;
    const fn = exercise.commands[command];
    if (fn === undefined) throw new Error(command);
    const code = await fn(ctx, args);
    return { code, out: [...out] };
  };
  return { ctx, run, spawned, exercise, who };
}

const resultIdIn = (lines: readonly string[]) =>
  /res_[0-9a-f]{16}/.exec(lines.join("\n"))?.[0] ?? "";

describe("the loop job", () => {
  it("says not started before setup, and what comes next after it", async () => {
    const { run } = harness("unstarted");
    const fresh = await run("done");
    expect(fresh.code).toBe(1);
    expect(fresh.out).toEqual([
      "02.1 · t",
      "",
      "Not started. Start it with: pnpm ex 02.1 setup",
    ]);
    // --details still shows every line.
    const all = await run("done", "--details");
    expect(all.out.filter((l) => l.startsWith("FAIL"))).toHaveLength(2);
    expect(all.out.at(-1)).toBe(
      "Not started. Start it with: pnpm ex 02.1 setup"
    );
    await run("setup");
    const set = await run("done");
    expect(set.code).toBe(1);
    expect(set.out).toEqual([
      "02.1 · t",
      "",
      "Set up. No run has started yet.",
      "Next: start Pi with pnpm pi --exercise 02.1, and have your agent start a run.",
    ]);
    // --details after setup lists every line, then closes the same way.
    const setAll = await run("done", "--details");
    expect(setAll.out.filter((l) => l.startsWith("FAIL"))).toHaveLength(2);
    expect(setAll.out.slice(-2)).toEqual(set.out.slice(-2));
    // A run still going: the guest waits, nothing to paste into Pi.
    await run("start");
    expect((await run("done")).out.slice(-2, -1)).toEqual([
      "Next: wait for the run to finish, then run this again.",
    ]);
  });

  it("counts the lines that pass, and gives the one fix when it's only the commit", async () => {
    const { run, who } = harness("only-commit");
    await run("setup");
    await run("start");
    await run("release");
    await run("consume", resultIdIn((await run("status")).out.slice(0, 1)));
    who.committed = false;
    const done = await run("done");
    expect(done.code).toBe(1);
    expect(done.out.slice(-3, -1)).toEqual([
      "Not done yet: 3 of 4 checks pass.",
      "Next: commit it, then run this again.",
    ]);
  });

  it("leaves an old run's result behind on setup, never as the current run", async () => {
    const { ctx, run } = harness("setup");
    expect((await run("setup")).code).toBe(0);
    const latest = await readLatestResult(ctx.stateDir);
    expect(latest?.resultId).toMatch(/^res_/);
    const state = fold(await readEvents(ctx.stateDir));
    expect(state.current).toBeNull();
    expect(state.runs).toHaveLength(1);
    expect((await run("status")).out[0]).toBe("Current run:  none");
  });

  it("start, release, consume once: done passes", async () => {
    const { run, spawned } = harness("happy");
    await run("setup");
    const started = await run("start");
    expect(started.code).toBe(0);
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.maxMs).toBe(300_000);
    expect((await run("done")).code).toBe(1);
    expect((await run("release")).code).toBe(0);
    const status = await run("status");
    const resultId = resultIdIn(status.out.slice(0, 1));
    expect(resultId).not.toBe("");
    expect((await run("consume", resultId)).code).toBe(0);
    const done = await run("done");
    expect(done.out.filter((l) => l.startsWith("PASS"))).toHaveLength(4);
    expect(done.out.filter((l) => /^(PASS|FAIL) /.test(l)).at(-1)).toBe(
      "PASS     committed"
    );
    expect(done.code).toBe(0);
  });

  it("done fails when the work isn't committed, whatever the job says", async () => {
    const { run, who } = harness("uncommitted");
    await run("setup");
    await run("start");
    await run("release");
    await run("consume", resultIdIn((await run("status")).out.slice(0, 1)));
    who.committed = false;
    const done = await run("done");
    expect(done.out.filter((l) => l.startsWith("PASS"))).toHaveLength(3);
    expect(done.out).toContain("FAIL     committed");
    expect(done.code).toBe(1);
  });

  it("records every consume and lets done judge: twice fails", async () => {
    const { run } = harness("twice");
    await run("setup");
    await run("start");
    await run("release");
    const resultId = resultIdIn((await run("status")).out.slice(0, 1));
    await run("consume", resultId);
    await run("consume", resultId);
    const done = await run("done");
    expect(done.code).toBe(1);
    expect(done.out).toContain(
      "FAIL     The run's result was consumed 2 times. It should be once."
    );
  });

  it("consuming result.json's stale result fails done", async () => {
    const { ctx, run } = harness("stale");
    await run("setup");
    await run("start");
    const stale = await readLatestResult(ctx.stateDir);
    expect((await run("consume", stale?.resultId ?? "")).code).toBe(0);
    await run("release");
    const fresh = resultIdIn((await run("status")).out.slice(0, 1));
    await run("consume", fresh);
    const done = await run("done");
    expect(done.code).toBe(1);
    expect(done.out).toContain(
      "FAIL     An old result was consumed by mistake."
    );
  });

  it("a superseded run still finishes late; its result is stale", async () => {
    const { ctx, run, spawned } = harness("late");
    await run("setup");
    await run("start");
    const second = await run("start");
    expect(second.out.join("\n")).toMatch(/was still going/);
    const first = spawned[0]?.runId ?? "";
    expect(await publish(ctx.stateDir, ctx.repoRoot, first)).not.toBeNull();
    expect((await readLatestResult(ctx.stateDir))?.runId).toBe(first);
    expect(fold(await readEvents(ctx.stateDir)).current?.result).toBeNull();
  });

  it("refuses an unknown result and a missing argument", async () => {
    const { run } = harness("refuse");
    await run("setup");
    expect((await run("consume")).code).toBe(2);
    expect((await run("consume", "res_0000000000000000")).code).toBe(1);
  });

  it("start takes no options; the test bound is an env var, and a bad one is refused", async () => {
    const { run, who } = harness("options");
    await run("setup");
    const flagged = await run("start", "--within", "2");
    expect(flagged.code).toBe(2);
    expect(flagged.out.join("\n")).toMatch(/start takes no options/);
    who.within = "soon";
    const bad = await run("start");
    expect(bad.code).toBe(2);
    expect(bad.out.join("\n")).toMatch(/TMX_TEST_WITHIN_MINUTES/);
  });

  it("a run under the test window says so at start, and done fails it", async () => {
    const { run, who } = harness("test-window");
    await run("setup");
    who.within = "0.5";
    const started = await run("start");
    expect(started.out.join("\n")).toMatch(
      /TMX_TEST_WITHIN_MINUTES is set: this is a test run, and done won't count it/
    );
    await run("release");
    const resultId = resultIdIn((await run("status")).out.slice(0, 1));
    await run("consume", resultId);
    const done = await run("done");
    expect(done.code).toBe(1);
    expect(done.out).toContain(
      "FAIL     The current run is a test run, so it doesn't count."
    );
    // A wrapped detail joined up again.
    expect(done.out.join("\n").replaceAll(/\n {9}/g, " ")).toMatch(
      /used the test-only window \(TMX_TEST_WITHIN_MINUTES=0\.5\); start a normal run/
    );
  });

  it("done counts only a consume from a top-level Pi, and notes the rest", async () => {
    const { run, who } = harness("top-level");
    await run("setup");
    await run("start");
    await run("release");
    const resultId = resultIdIn((await run("status")).out.slice(0, 1));
    who.session = NESTED;
    await run("consume", resultId);
    const nested = await run("done");
    expect(nested.code).toBe(1);
    expect(nested.out).toContain(
      "Note: 1 consume from outside a top-level Pi session, not counted."
    );
    who.session = TOP;
    await run("consume", resultId);
    const done = await run("done");
    expect(done.code).toBe(0);
    // The note is the last line above the verdict's blank line.
    expect(done.out[done.out.lastIndexOf("") - 1]).toBe(
      "Note: 1 consume from outside a top-level Pi session, not counted."
    );
  });

  it("a timer for a run that was reset away does nothing", async () => {
    const { ctx, run, spawned } = harness("reset");
    await run("setup");
    await run("start");
    await run("setup");
    expect(
      await publish(ctx.stateDir, ctx.repoRoot, spawned[0]?.runId ?? "")
    ).toBeNull();
  });

  it("keeps events in write order", async () => {
    const stateDir = join(scratch, "order");
    for (let i = 0; i < 20; i += 1) {
      await appendEvent(stateDir, {
        _tag: "ResultConsumed",
        resultId: `r${i}`,
        at: "x",
      });
    }
    const ids = (await readEvents(stateDir)).map((e) =>
      e._tag === "ResultConsumed" ? e.resultId : ""
    );
    expect(ids).toEqual(Array.from({ length: 20 }, (_, i) => `r${i}`));
  });

  it("picks a finish time between the minimum and the bound", () => {
    expect(pickDelay(180_000, 0)).toBe(minFinishMs);
    expect(pickDelay(180_000, 1)).toBe(180_000);
    expect(pickDelay(1_000, 0.5)).toBe(minFinishMs);
    expect(pickDelay(480_000, 0, 180_000)).toBe(180_000);
    expect(pickDelay(480_000, 1, 180_000)).toBe(480_000);
    expect(pickDelay(60_000, 0.5, 180_000)).toBe(180_000);
    expect(pickDelay(480_000, 0, 1)).toBe(minFinishMs);
  });

  it("by default a run takes several minutes; the test env var sets the bound", async () => {
    const { run, spawned, who } = harness("window");
    await run("setup");
    const started = await run("start");
    expect(started.out[0]).toMatch(/in the next 5 minutes/);
    expect(spawned[0]).toMatchObject({ maxMs: 300_000, minMs: 120_000 });
    who.within = "0.5";
    await run("start");
    expect(spawned[1]).toEqual({
      runId: spawned[1]?.runId,
      maxMs: 30_000,
    });
  });

  it("start begins the step when setup never ran; an earlier setup keeps its time", async () => {
    const StepStart = Schema.Struct({ at: Schema.String });
    const fresh = harness("step-by-start");
    await fresh.run("start");
    const started = await readJson(stepStartPath(fresh.ctx), StepStart);
    expect(Date.parse(started.at)).toBeGreaterThan(0);

    const setUp = harness("step-by-setup");
    await setUp.run("setup");
    const first = await readJson(stepStartPath(setUp.ctx), StepStart);
    await new Promise((wake) => setTimeout(wake, 5));
    await setUp.run("start");
    expect(await readJson(stepStartPath(setUp.ctx), StepStart)).toEqual(first);
  });

  it("a practice copy (another TMX_STATE_DIR, a quick run) leaves the real job alone", async () => {
    const real = harness("practice-real");
    const practice = harness("practice-copy");
    await real.run("setup");
    await practice.run("setup");
    practice.who.within = "0.5";
    await practice.run("start");
    await practice.run("release");
    const resultId = resultIdIn((await practice.run("status")).out.slice(0, 1));
    expect((await practice.run("consume", resultId)).code).toBe(0);
    expect((await practice.run("done", "--details")).out.join("\n")).toMatch(
      /test-only window/
    );
    expect((await real.run("status")).out).toContain("Consumed:     none");
    expect((await real.run("status")).out[0]).toBe("Current run:  none");
    expect((await real.run("done")).code).toBe(1);
  });

  it("stamps start, release and consume with the calling session", async () => {
    const { ctx, run, who } = harness("stamps");
    await run("setup");
    who.session = "ses_a";
    await run("start");
    who.session = null;
    await run("release");
    who.session = "ses_b";
    const resultId = resultIdIn((await run("status")).out.slice(0, 1));
    await run("consume", resultId);
    const events = await readEvents(ctx.stateDir);
    expect(events.map((e) => [e._tag, e.session ?? null])).toEqual([
      ["RunStarted", null],
      ["ResultPublished", null],
      ["RunStarted", "ses_a"],
      ["ResultPublished", null],
      ["ResultConsumed", "ses_b"],
    ]);
  });

  it("the real timer exits soon after the run is released", async () => {
    const { ctx, run } = harness("timer");
    await run("setup");
    const runId = await startRun(ctx.stateDir);
    const pid = spawnFinisher(ctx.repoRoot, ctx.stateDir, runId, 600_000);
    expect(pid).not.toBeNull();
    try {
      await new Promise((wake) => setTimeout(wake, 300));
      expect(pidAlive(pid ?? 0)).toBe(true);
      await publish(ctx.stateDir, ctx.repoRoot, runId);
      const until = Date.now() + 8_000;
      while (pidAlive(pid ?? 0) && Date.now() < until) {
        await new Promise((wake) => setTimeout(wake, 100));
      }
      expect(pidAlive(pid ?? 0)).toBe(false);
    } finally {
      if (pid !== null && pidAlive(pid)) {
        process.kill(pid, "SIGTERM");
      }
    }
  });

  it("offers catch-up in 02.1 only", () => {
    expect(Object.keys(harness("c1").exercise.commands)).toContain("catch-up");
    expect(Object.keys(harness("c2", "02.2").exercise.commands)).not.toContain(
      "catch-up"
    );
  });
});
