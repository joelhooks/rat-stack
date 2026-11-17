import { existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { commitClaimName, stepStartPath } from "#shared/core/commit-line.ts";
import { tempContext } from "#shared/core/testing.ts";
import { cast } from "#shared/several-agents/cast.ts";
import type { EnvState } from "#shared/several-agents/environment.ts";
import {
  defaultDeps,
  severalAgentsExercise,
} from "#shared/several-agents/exercise.ts";
import { judge, type Named } from "#shared/several-agents/judge.ts";

// The done check's own rules, as stories: given what the guest's command
// printed about the environment's five sessions, which lines pass. None of
// them knows or cares how the guest's tool worked a state out.
//
//   kiwi  busy on a long tool call            → working
//   lark  asked you a question                → waiting
//   moth  parked its build on a wait          → working, not waiting
//   newt  waiting on another session's reply  → working, not waiting
//   orca  killed in the middle of a tool call → stopped

const named: Named[] = cast.map((role, i) => ({
  name: role.name,
  session: `ses_mwgo${i}_aaaaaaaaaaa${i}`,
  pid: 101 + i,
}));
const verdict = (output: string) => judge(output, named).map((c) => c.ok);
const texts = (output: string) => judge(output, named).map((c) => c.text);

const correct = [
  "kiwi  working  pid 101  in a tool call",
  "lark  waiting  pid 102  asks: which colour, red or blue?",
  "moth  working  pid 103  parked until it's woken",
  "newt  working  pid 104  parked until it's woken",
  "orca  stopped  killed",
].join("\n");

describe("the 05.1 done check", () => {
  it("passes when each session shows its state", () => {
    expect(verdict(correct)).toEqual([true, true, true, true, true]);
  });

  it("passes with colour, a header, a footer and the guest's own sessions", () => {
    const output = [
      "SESSION  STATE    NOTE",
      "\u001b[32mkiwi\u001b[0m  \u001b[1mworking\u001b[0m  bash: sleep 3600",
      "main     working  the guest's own session",
      "lark     \u001b[33mwaiting\u001b[0m  → Which colour do you want?",
      "moth     working  waiting on its build, not on you",
      "newt     working  asked the reviewer; waiting on its reply",
      "orca     stopped  killed by SIGKILL",
      "",
      "5 running (1 waiting on you, 4 working), 1 stopped",
    ].join("\n");
    expect(verdict(output)).toEqual([true, true, true, true, true]);
  });

  it("finds a session by its workshop session ID instead of its name", () => {
    const output = named
      .map(
        (n, i) =>
          `${n.session} ${["working", "waiting", "working", "working", "stopped"][i]}`
      )
      .join("\n");
    expect(verdict(output)).toEqual([true, true, true, true, true]);
  });

  it("gives a line to the first session it names", () => {
    const output = correct.replace(
      "newt  working  pid 104  parked until it's woken",
      "newt  working  asked kiwi a question"
    );
    expect(verdict(output)).toEqual([true, true, true, true, true]);
  });

  it("fails parked sessions shown waiting on the guest: every idle turn read as a question", () => {
    const output = correct
      .replace("moth  working", "moth  waiting")
      .replace("newt  working", "newt  waiting");
    expect(verdict(output)).toEqual([true, true, false, false, true]);
    expect(texts(output)[2]).toBe(
      "The output shows moth (parked its build on a wait) as waiting, but nothing in it is waiting on you."
    );
  });

  it("fails a working session shown waiting or stopped", () => {
    expect(verdict(correct.replace("kiwi  working", "kiwi  waiting"))).toEqual([
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(verdict(correct.replace("kiwi  working", "kiwi  stopped"))[0]).toBe(
      false
    );
  });

  it("fails the session asking a question shown working", () => {
    const output = correct.replace("lark  waiting", "lark  working");
    expect(verdict(output)).toEqual([true, false, true, true, true]);
    expect(texts(output)[1]).toBe(
      "The output shows lark (asked you a question) as working. It should be waiting."
    );
  });

  it("fails the killed session shown working: its last message is still a tool call", () => {
    const output = correct.replace("orca  stopped", "orca  working");
    expect(verdict(output)).toEqual([true, true, true, true, false]);
  });

  it("fails the killed session left out: only running sessions listed", () => {
    const output = correct.replace("orca  stopped  killed", "");
    expect(verdict(output)).toEqual([true, true, true, true, false]);
    expect(texts(output)[4]).toBe(
      "No line of the output names orca (killed in the middle of a tool call)."
    );
  });

  it("fails a session whose line has none of the three words", () => {
    const output = correct.replace("newt  working", "newt  idle");
    expect(texts(output)[3]).toBe(
      "The line for newt (waiting on another session's reply) has none of the words working, waiting or stopped."
    );
  });

  it("fails a session shown two ways", () => {
    const output = `${correct}\nwaiting on you: lark, kiwi`;
    expect(verdict(output)).toEqual([true, true, true, true, true]);
    const twice = `${correct.replace("pid 101", "")}\nkiwi is waiting on you`;
    expect(texts(twice)[0]).toBe(
      "The output shows kiwi (busy on a long tool call) as both working and waiting. If one line is an older session with the same name, put the live one's PID or session ID on its line."
    );
  });

  it("lets the live session's PID or session ID decide over an older one with the same name", () => {
    const stale = [
      "tmx-05.1-kiwi  stopped  -  an older conversation",
      "tmx-05.1-lark  stopped  -  an older conversation",
    ].join("\n");
    expect(verdict(`${correct}\n${stale}`)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    const bySession = `${named[0]?.session ?? ""}  kiwi  working\nkiwi  stopped  old`;
    expect(
      verdict(`${correct.replace(/^kiwi.*$/m, "")}\n${bySession}`)[0]
    ).toBe(true);
    const noIds = correct.replace("pid 101", "");
    expect(verdict(`${noIds}\n${stale}`).slice(0, 2)).toEqual([false, true]);
  });

  it("counts whole words only", () => {
    const output = correct
      .replace("kiwi  working", "kiwis  working")
      .replace("lark  waiting", "lark  networking");
    expect(verdict(output)).toEqual([false, false, true, true, true]);
  });

  it("fails every line on empty output", () => {
    expect(verdict("")).toEqual([false, false, false, false, false]);
  });
});

// `done` itself, with the sessions, the guest's command and the commit line
// stood in for: what it prints and how it exits.
describe("the 05.1 done command", () => {
  let cleanup: () => Promise<void> = async () => undefined;
  afterEach(() => cleanup());

  const ready: EnvState = {
    run: "run_test",
    hostPid: 1,
    status: "ready",
    error: null,
    startedAt: "2026-11-17T16:00:00.000Z",
    stopsBy: "2026-11-17T16:10:00.000Z",
    sessions: named.map((n) => ({
      name: n.name,
      session: n.session,
      piSessionId: `tmx-05.1-${n.name}`,
      pid: 1,
      launcherPid: 1,
    })),
  };

  async function run(
    args: string[],
    opts: { stdout?: string; committed?: boolean; env?: EnvState } = {}
  ): Promise<{
    code: number;
    lines: string[];
    stopped: number;
    commands: string[];
  }> {
    const temp = await tempContext({ exerciseId: "05.1" });
    cleanup = temp.cleanup;
    const lines: string[] = [];
    let stopped = 0;
    const commands: string[] = [];
    const exercise = severalAgentsExercise(
      { id: "05.1", title: "test" },
      {
        ...defaultDeps,
        out: (line) => lines.push(line),
        err: (line) => lines.push(line),
        startSet: async () => opts.env ?? ready,
        stopSet: async () => {
          stopped += 1;
          return null;
        },
        runCommand: async (command) => {
          commands.push(command);
          return {
            code: 0,
            stdout: opts.stdout ?? correct,
            stderr: "",
            ms: 5,
            timedOut: false,
          };
        },
        commit: async () => ({
          name: commitClaimName,
          ok: opts.committed ?? true,
          detail: opts.committed === false ? "nothing committed" : "committed",
        }),
      }
    );
    const done = exercise.commands["done"];
    if (done === undefined) {
      throw new Error("05.1 has no done command");
    }
    const code = await done(temp.ctx, args);
    return { code, lines, stopped, commands };
  }

  const verdicts = (lines: string[]) =>
    lines.filter((l) => /^(PASS|FAIL) {2}/.test(l)).map((l) => l.slice(0, 4));

  it("passes all five sessions and ends with the commit line", async () => {
    const { code, lines, stopped } = await run(["pnpm", "sessions"]);
    expect(code).toBe(0);
    expect(stopped).toBe(1);
    expect(verdicts(lines)).toEqual(Array(6).fill("PASS"));
    expect(lines).toContain(
      "PASS     This step's work is committed, through your commit hook."
    );
    expect(lines.slice(-3)).toEqual([
      "Done.",
      "Next: 06.1 · Split three ways. Start it with: pnpm ex 06.1 setup",
      "More: pnpm ex 05.1 done --details pnpm sessions",
    ]);
  });

  it("takes --details only before the guest's command, never out of it", async () => {
    const inside = await run(["pnpm", "sessions", "--details"]);
    expect(inside.commands).toEqual(["pnpm sessions --details"]);
    expect(inside.lines.join("\n")).not.toContain("Its output:");
    const before = await run(["--details", "pnpm", "sessions"]);
    expect(before.commands).toEqual(["pnpm sessions"]);
    expect(before.lines.join("\n")).toContain("Its output:");
    const plain = await run(["pnpm", "sessions"]);
    expect(plain.lines.at(-1)).toBe(
      "More: pnpm ex 05.1 done --details pnpm sessions"
    );
  });

  it("fails on the commit line alone", async () => {
    const { code, lines } = await run(["pnpm sessions"], { committed: false });
    expect(code).toBe(1);
    expect(verdicts(lines)).toEqual([...Array(5).fill("PASS"), "FAIL"]);
  });

  it("fails when the guest's output misreads a session", async () => {
    const stdout = correct.replace("moth  working", "moth  waiting");
    const { code, lines } = await run(["pnpm sessions"], { stdout });
    expect(code).toBe(1);
    expect(verdicts(lines)[2]).toBe("FAIL");
  });

  it("fails one line when the sessions don't start", async () => {
    const env: EnvState = { ...ready, status: "failed", error: "no Pi" };
    const { code, lines } = await run(["pnpm sessions"], { env });
    expect(code).toBe(1);
    expect(lines).toContain(
      "FAIL     The environment's sessions didn't start."
    );
    expect(lines).toContain("         No Pi.");
    expect(lines.slice(-2)).toEqual([
      "Not done yet: the environment's sessions didn't start.",
      "Next: run this again.",
    ]);
  });

  it("asks for a command when none is given", async () => {
    const { code, lines } = await run([]);
    expect(code).toBe(2);
    expect(lines).toEqual([
      "Give your command: pnpm ex 05.1 done <your command>",
    ]);
  });

  it("marks the step's start on setup, for the commit line", async () => {
    const temp = await tempContext({ exerciseId: "05.1" });
    cleanup = temp.cleanup;
    const exercise = severalAgentsExercise(
      { id: "05.1", title: "test" },
      { ...defaultDeps, out: () => undefined, stopSet: async () => null }
    );
    expect(existsSync(stepStartPath(temp.ctx))).toBe(false);
    expect(await exercise.commands.setup(temp.ctx, [])).toBe(0);
    expect(existsSync(stepStartPath(temp.ctx))).toBe(true);
  });
});
