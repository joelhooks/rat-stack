import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { findRepoRoot } from "#shared/core/context.ts";
import type { SessionRecord } from "#shared/core/sessions.ts";

import {
  discoverExercises,
  parseExArgs,
  runEx,
  workshopLine,
} from "./exercises.ts";

const repoRoot = findRepoRoot();
const fixtures = join(repoRoot, "scripts", "lib", "fixtures", "exercises");

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (line: string) => out.push(line),
      err: (line: string) => err.push(line),
    },
  };
}

function run(argv: string[]) {
  const c = capture();
  const done = runEx(argv, {
    repoRoot,
    exercisesDir: fixtures,
    env: { TMX_STATE_DIR: "/nonexistent/unused" },
    io: c.io,
  });
  return { ...c, done };
}

describe("parseExArgs", () => {
  it("splits id, command and args", () => {
    expect(parseExArgs(["02.1", "status", "-x", "y"])).toEqual({
      id: "02.1",
      command: "status",
      args: ["-x", "y"],
    });
    expect(parseExArgs([])).toEqual({
      id: undefined,
      command: undefined,
      args: [],
    });
  });

  it("skips a bare -- before the command, not after it", () => {
    expect(parseExArgs(["--", "02.1", "--", "consume", "--", "x"])).toEqual({
      id: "02.1",
      command: "consume",
      args: ["--", "x"],
    });
  });
});

describe("discovery", () => {
  it("finds exercise folders, runnable or readme-only", async () => {
    const entries = await discoverExercises(fixtures);
    expect(entries.map((e) => [e.id, e.slug, e.runnable])).toEqual([
      ["90.1", "demo", true],
      ["90.2", "readme-only", false],
    ]);
  });

  it("finds the real exercises, every one runnable", async () => {
    const entries = await discoverExercises(join(repoRoot, "exercises"));
    expect(entries.map((e) => e.id)).toContain("00.1");
    expect(entries.map((e) => e.id)).toContain("02.1");
    expect(entries.every((e) => e.runnable)).toBe(true);
  });
});

describe("runEx", () => {
  it("lists exercises and commands with no args", async () => {
    const r = run([]);
    expect(await r.done).toBe(0);
    expect(r.out).toContain("90.1  demo  setup, status, echo, boom, test");
    expect(r.out).toContain("90.2  readme-only  (readme only)");
  });

  it("runs a command with the exercise's context", async () => {
    expect(await run(["90.1", "status"]).done).toBe(3);
  });

  it("starts status, and only status, with the workshop facts", async () => {
    const status = run(["90.1", "status"]);
    await status.done;
    expect(status.out[0]).toMatch(/^Workshop: no TMX_SESSION/);
    const echo = run(["90.1", "echo"]);
    await echo.done;
    expect(echo.out.join("\n")).not.toContain("Workshop:");
  });

  it("passes args through and reports a throwing command", async () => {
    expect(await run(["90.1", "echo", "a", "b"]).done).toBe(2);
    const r = run(["90.1", "boom"]);
    expect(await r.done).toBe(1);
    expect(r.err.join("\n")).toMatch(/90\.1 boom failed: TODO: not done/);
  });

  it("names the valid choices for an unknown id or command", async () => {
    const id = run(["99.9", "status"]);
    expect(await id.done).toBe(2);
    expect(id.err).toContain("Valid ids: 90.1, 90.2");
    const cmd = run(["90.1", "nope"]);
    expect(await cmd.done).toBe(2);
    expect(cmd.err).toContain(
      "Valid commands: setup, status, echo, boom, test"
    );
    const readmeOnly = run(["90.2", "status"]);
    expect(await readmeOnly.done).toBe(2);
    expect(readmeOnly.err.join("\n")).toMatch(/no exercise\.ts yet/);
  });

  it("runs vitest on just the exercise folder for test", async () => {
    const calls: [string, string | undefined][] = [];
    const code = await runEx(["90.1", "test"], {
      repoRoot,
      exercisesDir: fixtures,
      env: {},
      io: capture().io,
      runTests: async (folder, env) => {
        calls.push([folder, env["TMX_EXERCISE"]]);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual([
      [
        join("scripts", "lib", "fixtures", "exercises", "90-demo", "90.1-demo"),
        "90.1",
      ],
    ]);
  });
});

describe("workshopLine", () => {
  const record = (
    session: string,
    parentSession: string | null
  ): SessionRecord => ({
    session,
    parentSession,
    piSessionId: "tmx-02.1-main",
    pid: 1,
    role: "main",
    exercise: "02.1",
    startedAt: "2026-11-11T00:00:00.000Z",
    endedAt: null,
    ended: null,
    exitCode: null,
    exitSignal: null,
  });
  const outer = "ses_a_000000000000";
  const inner = "ses_b_000000000000";
  const records = [record(outer, null), record(inner, outer)];

  it("names the session, its nesting, the exercise, the role and the guest's Pi", () => {
    expect(
      workshopLine(
        {
          TMX_SESSION: outer,
          TMX_EXERCISE: "02.1",
          TMX_ROLE: "main",
          TMX_GUEST_PI_PID: "4242",
        },
        records
      )
    ).toBe(
      `Workshop: TMX_SESSION=${outer} (top-level), TMX_EXERCISE=02.1, TMX_ROLE=main, TMX_GUEST_PI_PID=4242`
    );
    expect(workshopLine({ TMX_SESSION: inner }, records)).toBe(
      `Workshop: TMX_SESSION=${inner} (nested in ${outer})`
    );
    expect(workshopLine({ TMX_SESSION: "ses_c_000000000000" }, [])).toContain(
      "(no record of it)"
    );
  });

  it("prints only TMX names, never anything else from the env", () => {
    const line = workshopLine(
      { TMX_SESSION: outer, PI_TOKEN: "x", ANTHROPIC_API_KEY: "sk-secret" },
      records
    );
    expect(line).not.toContain("secret");
    expect(line).not.toContain("PI_TOKEN");
  });
});

describe("pnpm ex CLI", () => {
  it("fails an unknown id with the valid list", async () => {
    const result = await promisify(execFile)(
      process.execPath,
      [join(repoRoot, "scripts", "ex.ts"), "99.9", "status"],
      { cwd: repoRoot }
    ).then(
      () => ({ code: 0, stderr: "" }),
      (error: { code: number; stderr: string }) => error
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/Valid ids: 00\.1/);
  });
});
