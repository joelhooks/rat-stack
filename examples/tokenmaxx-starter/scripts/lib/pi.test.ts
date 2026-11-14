import { execFile, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { findRepoRoot } from "#shared/core/context.ts";
import {
  readSession,
  readSessions,
  type SessionRecord,
  sessionsDir,
  writeSession,
} from "#shared/core/sessions.ts";
import {
  fold,
  publish,
  readEvents,
  recordConsume,
  startRun,
} from "#shared/own-loop/job.ts";

import type { Ancestry } from "./ancestry.ts";
import {
  buildPiArgs,
  createPiSessionQuietly,
  freshSessionId,
  launchPi,
  observerPath,
  parseLaunchArgs,
  piCliPath,
  planLaunch,
  sessionIdFor,
} from "./pi.ts";

const starter = findRepoRoot();
const fixtures = join(starter, "scripts", "lib", "fixtures");

// planLaunch reads the session records under its repo root, so these tests
// launch from a root of their own: this checkout's Pi and exercises, linked,
// with no records. A guest Pi running here (holding tmx-02.1-main, say) then
// can't change what they see.
const repoRoot = await mkdtemp(join(tmpdir(), "tmx-plan-"));
await symlink(join(starter, "node_modules"), join(repoRoot, "node_modules"));
await symlink(join(starter, "exercises"), join(repoRoot, "exercises"));
afterAll(() => rm(repoRoot, { recursive: true, force: true }));

/** A plain shell: no recorded Pi above it, whatever runs these tests. */
const plain: Ancestry = { ancestors: () => [], alive: () => true };

describe("parseLaunchArgs", () => {
  it("defaults to the main role and passes the rest to Pi", () => {
    expect(parseLaunchArgs(["--model", "x", "hello"])).toEqual({
      role: "main",
      exercise: undefined,
      fresh: false,
      piArgs: ["--model", "x", "hello"],
    });
  });

  it("takes role and exercise in either form", () => {
    expect(
      parseLaunchArgs(["--role=second", "--exercise", "02.1", "--fresh", "-c"])
    ).toEqual({
      role: "second",
      exercise: "02.1",
      fresh: true,
      piArgs: ["-c"],
    });
  });

  it("passes everything after -- to Pi as flags, without the -- itself", () => {
    const parsed = parseLaunchArgs([
      "--exercise",
      "02.1",
      "--",
      "--role",
      "x",
      "-ne",
      "-ns",
    ]);
    expect(parsed.exercise).toBe("02.1");
    expect(parsed.role).toBe("main");
    expect(parsed.piArgs).toEqual(["--role", "x", "-ne", "-ns"]);
  });

  it("rejects bad roles and missing values", () => {
    expect(() => parseLaunchArgs(["--role", "Second"])).toThrow(/--role must/);
    expect(() => parseLaunchArgs(["--role"])).toThrow(/needs a value/);
  });
});

describe("Pi session ids", () => {
  it("is stable per exercise and role", () => {
    expect(sessionIdFor({ role: "second", exercise: "02.1" })).toBe(
      "tmx-02.1-second"
    );
    expect(sessionIdFor({ role: "main", exercise: undefined })).toBe(
      "tmx-main"
    );
  });

  it("adds --session-id unless the caller picked a session", () => {
    expect(buildPiArgs(["hi"], "tmx-a")).toEqual({
      args: ["--session-id", "tmx-a", "hi"],
      sessionId: "tmx-a",
    });
    expect(buildPiArgs(["-c"], "tmx-a")).toEqual({
      args: ["-c"],
      sessionId: null,
    });
    expect(buildPiArgs(["--session-id", "mine"], "tmx-a").sessionId).toBe(
      "mine"
    );
    expect(buildPiArgs(["--session-id=mine"], "tmx-a").sessionId).toBe("mine");
  });

  it("--fresh appends a UTC timestamp and a random tail to the stable id", () => {
    expect(
      freshSessionId("tmx-02.1-main", new Date(Date.UTC(2026, 10, 4)), "a1b2c3")
    ).toBe("tmx-02.1-main-20261104T000000000Z-a1b2c3");
    const at = new Date();
    expect(freshSessionId("x", at)).not.toBe(freshSessionId("x", at));
  });
});

describe("planLaunch", () => {
  it("resolves the exercise, env and pinned Pi", async () => {
    const launch = await planLaunch(
      ["--exercise", "00.1", "--role", "second"],
      repoRoot,
      {},
      plain
    );
    expect(launch.cli).toBe(piCliPath(repoRoot));
    expect(launch.args).toEqual([
      "-e",
      observerPath(repoRoot),
      "--session-id",
      "tmx-00.1-second",
    ]);
    expect(launch.env).toMatchObject({
      TMX_ROLE: "second",
      TMX_EXERCISE: "00.1",
      TMX_SESSION: launch.record.session,
    });
    expect(launch.record).toMatchObject({
      piSessionId: "tmx-00.1-second",
      parentSession: null,
      role: "second",
      exercise: "00.1",
      ended: null,
    });
  });

  it("gives every launch its own workshop session, resumed or not", async () => {
    const a = await planLaunch(["--exercise", "02.1"], repoRoot, {}, plain);
    const b = await planLaunch(["--exercise", "02.1"], repoRoot, {}, plain);
    expect(a.record.piSessionId).toBe(b.record.piSessionId);
    expect(a.record.session).not.toBe(b.record.session);
    expect(a.record.session).toMatch(/^ses_[0-9a-z]+_[0-9a-f]{12}$/);
  });

  it("records the session that ran pnpm pi as the parent", async () => {
    const parent = await planLaunch([], repoRoot, {}, plain);
    const child = await planLaunch(
      ["--role", "helper"],
      repoRoot,
      parent.env,
      plain
    );
    expect(child.record.parentSession).toBe(parent.record.session);
    expect(child.env["TMX_SESSION"]).toBe(child.record.session);
  });

  it("gives a Pi started from inside another Pi a conversation of its own", async () => {
    const parent = await planLaunch(
      ["--exercise", "02.2"],
      repoRoot,
      {},
      plain
    );
    expect(parent.record.piSessionId).toBe("tmx-02.2-main");
    // Two nested launches in the same moment, as an agent testing its work
    // might start them: neither gets the parent's conversation, nor each other's.
    const [a, b] = await Promise.all([
      planLaunch(["--exercise", "02.2"], repoRoot, parent.env, plain),
      planLaunch(
        ["--exercise", "02.2", "-p", "hi"],
        repoRoot,
        parent.env,
        plain
      ),
    ]);
    const ids = [parent, a, b].map((l) => l.record.piSessionId);
    expect(new Set(ids).size).toBe(3);
    expect(a.record.piSessionId).toMatch(/^tmx-02\.2-main-\d{8}T\d{9}Z-\w{6}$/);
    expect(a.record.parentSession).toBe(parent.record.session);
    expect(a.ownSessionId).toBe(a.record.piSessionId);
    // A nested caller that names its own session keeps it.
    const named = await planLaunch(
      ["--exercise", "02.2", "--session-id", "mine"],
      repoRoot,
      parent.env,
      plain
    );
    expect(named.record.piSessionId).toBe("mine");
    expect(named.ownSessionId).toBeNull();
  });

  it("exports the guest's launcher PID, and a nested Pi keeps it", async () => {
    const guest = await planLaunch(["--exercise", "02.1"], repoRoot, {}, plain);
    expect(guest.env["TMX_GUEST_PI_PID"]).toBe(String(process.pid));
    const nested = await planLaunch(
      ["--exercise", "02.1"],
      repoRoot,
      {
        ...guest.env,
        TMX_GUEST_PI_PID: "4242",
      },
      plain
    );
    expect(nested.env["TMX_GUEST_PI_PID"]).toBe("4242");
    // A top-level launch never inherits a stale value from its terminal.
    const fresh = await planLaunch(
      [],
      repoRoot,
      { TMX_GUEST_PI_PID: "4242" },
      plain
    );
    expect(fresh.env["TMX_GUEST_PI_PID"]).toBe(String(process.pid));
  });

  describe("with the process tree", () => {
    let root = "";
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    // The guest's Pi (pid 300, launched by 299) runs a bash tool (400) that
    // runs pnpm (401), which runs this launcher.
    const guestRecord: SessionRecord = {
      session: "ses_mwbn641s_263394515268",
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
    };
    const tree = (alive = true): Ancestry => ({
      ancestors: () => [401, 400, 300, 299, 12],
      alive: () => alive,
    });
    async function withGuest(record: SessionRecord = guestRecord) {
      root = await mkdtemp(join(tmpdir(), "tmx-tree-"));
      await symlink(join(repoRoot, "node_modules"), join(root, "node_modules"));
      await writeSession(root, record);
      return root;
    }

    it("keeps a launch nested when its env was stripped", async () => {
      const dir = await withGuest();
      const launch = await planLaunch([], dir, {}, tree());
      expect(launch.record.parentSession).toBe(guestRecord.session);
      expect(launch.record.piSessionId).toMatch(
        /^tmx-main-\d{8}T\d{9}Z-\w{6}$/
      );
      expect(launch.env["TMX_GUEST_PI_PID"]).toBe("299");
    });

    it("believes the tree over a TMX_SESSION from somewhere else", async () => {
      const dir = await withGuest();
      const launch = await planLaunch(
        [],
        dir,
        { TMX_SESSION: "ses_other_000000000000", TMX_GUEST_PI_PID: "7" },
        tree()
      );
      expect(launch.record.parentSession).toBe(guestRecord.session);
      expect(launch.env["TMX_GUEST_PI_PID"]).toBe("299");
    });

    it("stays top-level from a plain shell, and ignores ended or dead records", async () => {
      const dir = await withGuest();
      const shell: Ancestry = {
        ancestors: () => [501, 500, 12],
        alive: () => true,
      };
      const top = await planLaunch(["--role", "second"], dir, {}, shell);
      expect(top.record.parentSession).toBeNull();
      expect(top.record.piSessionId).toBe("tmx-second");
      expect(top.env["TMX_GUEST_PI_PID"]).toBe(String(process.pid));
      // The guest's Pi has gone: its PID in our chain is someone else now.
      expect(
        (await planLaunch([], dir, {}, tree(false))).record.parentSession
      ).toBeNull();
      await writeSession(dir, { ...guestRecord, ended: "quit" });
      expect(
        (await planLaunch([], dir, {}, tree())).record.parentSession
      ).toBeNull();
    });

    it("doesn't match a reused PID whose parent isn't the recorded launcher", async () => {
      const dir = await withGuest({ ...guestRecord, launcherPid: 298 });
      const launch = await planLaunch([], dir, {}, tree());
      expect(launch.record.parentSession).toBeNull();
    });

    it("falls back to the env rule when the tree can't be read", async () => {
      const dir = await withGuest();
      const unknown: Ancestry = { ancestors: () => null, alive: () => true };
      expect(
        (await planLaunch([], dir, {}, unknown)).record.parentSession
      ).toBeNull();
      const nested = await planLaunch(
        [],
        dir,
        { TMX_SESSION: guestRecord.session, TMX_GUEST_PI_PID: "299" },
        unknown
      );
      expect(nested.record.parentSession).toBe(guestRecord.session);
      expect(nested.env["TMX_GUEST_PI_PID"]).toBe("299");
    });

    it("never resumes a conversation a running Pi has open, even outside its tree", async () => {
      // Reparented to PID 1 after its parent exited: no recorded Pi in the
      // chain, no TMX_SESSION, but the guest's Pi still has tmx-main open.
      const dir = await withGuest();
      const orphan: Ancestry = { ancestors: () => [700], alive: () => true };
      const launch = await planLaunch([], dir, {}, orphan);
      expect(launch.record.piSessionId).toMatch(
        /^tmx-main-\d{8}T\d{9}Z-\w{6}$/
      );
      expect(launch.ownSessionId).toBe(launch.record.piSessionId);
      expect(launch.record.parentSession).toBeNull();
      expect(launch.notice).toBe(
        "tmx-main is already open in another Pi (pid 300), so this one starts a new conversation."
      );
      // Another conversation is free to resume, and says nothing.
      const other = await planLaunch(["--role", "second"], dir, {}, orphan);
      expect(other.record.piSessionId).toBe("tmx-second");
      expect(other.notice).toBeNull();
      // Nested launches start fresh anyway, quietly.
      expect((await planLaunch([], dir, {}, tree())).notice).toBeNull();
    });

    it("records its own launcher PID", async () => {
      const dir = await withGuest();
      const launch = await planLaunch([], dir, {}, plain);
      expect(launch.record.launcherPid).toBe(process.pid);
    });
  });

  it("starts a new Pi session with --fresh", async () => {
    const launch = await planLaunch(
      ["--exercise", "00.1", "--fresh"],
      repoRoot,
      {},
      plain
    );
    expect(launch.record.piSessionId).toMatch(
      /^tmx-00\.1-main-\d{8}T\d{9}Z-\w{6}$/
    );
    expect(launch.args).toEqual([
      "-e",
      observerPath(repoRoot),
      "--session-id",
      launch.record.piSessionId,
    ]);
    await expect(
      planLaunch(["--fresh", "--session-id", "x"], repoRoot, {}, plain)
    ).rejects.toThrow(/--fresh picks its own session/);
  });

  describe("02.2's open run", () => {
    let root = "";
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });

    const stateDir = () => join(root, ".workshop-state", "02.2");

    /** A guest's `--fresh` 02.2 Pi that started a run, then quit. */
    async function freshRunThenQuit(
      record: Partial<SessionRecord> = {}
    ): Promise<SessionRecord> {
      root = await mkdtemp(join(tmpdir(), "tmx-wait-"));
      await symlink(join(repoRoot, "node_modules"), join(root, "node_modules"));
      await symlink(join(repoRoot, "exercises"), join(root, "exercises"));
      const first = await planLaunch(
        ["--exercise", "02.2", "--fresh"],
        root,
        {},
        plain
      );
      const started: SessionRecord = {
        ...first.record,
        pid: 300,
        ended: "quit",
        endedAt: "2026-11-12T01:00:00.000Z",
        exitCode: 0,
        ...record,
      };
      await writeSession(root, started);
      await startRun(stateDir(), { session: started.session });
      return started;
    }

    it("resumes the --fresh conversation that started it, on a plain relaunch", async () => {
      const started = await freshRunThenQuit();
      expect(started.piSessionId).toMatch(/^tmx-02\.2-main-\d{8}T/);
      const again = await planLaunch(["--exercise", "02.2"], root, {}, plain);
      expect(again.record.piSessionId).toBe(started.piSessionId);
      expect(again.ownSessionId).toBe(started.piSessionId);
      expect(again.args).toContain(started.piSessionId);
      expect(again.record.session).not.toBe(started.session);
      expect(again.record.parentSession).toBeNull();
      expect(again.notice).toBe(
        `Resuming ${started.piSessionId}: the conversation that started the open 02.2 run.`
      );
    });

    it("follows TMX_STATE_DIR, as the exercise commands do", async () => {
      const started = await freshRunThenQuit();
      const elsewhere = join(root, "elsewhere");
      const env = { TMX_STATE_DIR: elsewhere };
      expect(
        (await planLaunch(["--exercise", "02.2"], root, env, plain)).record
          .piSessionId
      ).toBe("tmx-02.2-main");
      await startRun(elsewhere, { session: started.session });
      expect(
        (await planLaunch(["--exercise", "02.2"], root, env, plain)).record
          .piSessionId
      ).toBe(started.piSessionId);
    });

    it("starts fresh with --fresh, and leaves other exercises and roles alone", async () => {
      await freshRunThenQuit();
      const fresh = await planLaunch(
        ["--exercise", "02.2", "--fresh"],
        root,
        {},
        plain
      );
      expect(fresh.record.piSessionId).toMatch(/^tmx-02\.2-main-\d{8}T/);
      expect(fresh.notice).toBeNull();
      for (const [argv, id] of [
        [["--exercise", "02.1"], "tmx-02.1-main"],
        [["--exercise", "02.2", "--role", "second"], "tmx-02.2-second"],
        [["--exercise", "02.2", "--session-id", "mine"], "mine"],
      ] as const) {
        expect(
          (await planLaunch(argv, root, {}, plain)).record.piSessionId
        ).toBe(id);
      }
    });

    it("resumes the usual conversation once the run's result was consumed", async () => {
      await freshRunThenQuit();
      const { current } = fold(await readEvents(stateDir()));
      const result = await publish(stateDir(), starter, current?.runId ?? "");
      expect(result).not.toBeNull();
      await recordConsume(stateDir(), result?.resultId ?? "", "ses_later");
      const again = await planLaunch(["--exercise", "02.2"], root, {}, plain);
      expect(again.record.piSessionId).toBe("tmx-02.2-main");
      expect(again.notice).toBeNull();
    });

    it("never resumes it while a running Pi has it open", async () => {
      await freshRunThenQuit({ ended: null, endedAt: null, exitCode: null });
      const again = await planLaunch(["--exercise", "02.2"], root, {}, plain);
      expect(again.record.piSessionId).toBe("tmx-02.2-main");
      expect(again.notice).toBeNull();
    });

    it("keeps nested launches as they are, and ignores a run a nested Pi started", async () => {
      const started = await freshRunThenQuit();
      const nested = await planLaunch(
        ["--exercise", "02.2"],
        root,
        { TMX_SESSION: started.session },
        plain
      );
      expect(nested.record.parentSession).toBe(started.session);
      expect(nested.record.piSessionId).not.toBe(started.piSessionId);
      expect(nested.record.piSessionId).toMatch(/^tmx-02\.2-main-\d{8}T/);

      const test = { ...nested.record, pid: 301, ended: "quit" as const };
      await writeSession(root, test);
      await startRun(stateDir(), { session: test.session });
      expect(
        (await planLaunch(["--exercise", "02.2"], root, {}, plain)).record
          .piSessionId
      ).toBe("tmx-02.2-main");
    });
  });

  it("refuses unknown exercises", async () => {
    await expect(
      planLaunch(["--exercise", "99.9"], repoRoot, {}, plain)
    ).rejects.toThrow(/Valid ids: 00\.1/);
  });

  it("starts any exercise whether or not a catch-up ran", async () => {
    for (const id of ["00.1", "02.1"]) {
      await expect(
        planLaunch(["--exercise", id], repoRoot, {}, plain)
      ).resolves.toMatchObject({ record: { exercise: id } });
    }
  });
});

describe("the session record", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  async function launchFake(args: readonly string[]) {
    root = await mkdtemp(join(tmpdir(), "tmx-launch-"));
    const launch = await planLaunch(
      ["--exercise", "02.1"],
      repoRoot,
      {},
      plain
    );
    const running = launchPi(
      {
        ...launch,
        cli: join(fixtures, "fake-pi.ts"),
        args,
        ownSessionId: null,
      },
      root
    );
    const started = await waitFor(root, launch.record.session);
    return { root, launch, running, started };
  }

  async function waitFor(dir: string, session: string) {
    for (let i = 0; i < 100; i += 1) {
      const records = await readSessions(dir);
      const found = records.find((r) => r.session === session);
      if (found !== undefined) {
        return found;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("launcher never wrote the start record");
  }

  it("writes a start record with Pi's own PID, then the end", async () => {
    const { root: dir, launch, running, started } = await launchFake([]);
    expect(started).toMatchObject({
      session: launch.record.session,
      exercise: "02.1",
      endedAt: null,
      ended: null,
    });
    expect(started.pid).toBeGreaterThan(0);
    expect(started.pid).not.toBe(process.pid);
    process.kill(started.pid, "SIGTERM");
    expect(await running).toBe(143);
    const ended = await readSession(dir, launch.record.session);
    expect(ended).toMatchObject({
      pid: started.pid,
      ended: "signal",
      exitSignal: "SIGTERM",
      exitCode: null,
    });
    expect(ended.endedAt).not.toBeNull();
    expect(Date.parse(ended.endedAt ?? "")).toBeGreaterThanOrEqual(
      Date.parse(ended.startedAt)
    );
  });

  it("records a SIGTERM it passed on as signal, even when Pi then exits 0", async () => {
    const { root: dir, launch, running } = await launchFake(["--clean-term"]);
    await waitForFile(join(dir, "fake-pi-ready.json"));
    // What `kill <launcher pid>` or `pkill -f "scripts/pi.ts"` does.
    process.emit("SIGTERM");
    expect(await running).toBe(0);
    const ended = await readSession(dir, launch.record.session);
    expect(ended).toMatchObject({
      ended: "signal",
      exitCode: 0,
      exitSignal: "SIGTERM",
    });
  });

  it("records a clean exit as quit and a failing one as error", async () => {
    const quit = await launchFake(["--exit", "0"]);
    expect(await quit.running).toBe(0);
    expect(
      (await readSession(quit.root, quit.launch.record.session)).ended
    ).toBe("quit");
    await rm(quit.root, { recursive: true, force: true });
    const failed = await launchFake(["--exit", "3"]);
    expect(await failed.running).toBe(3);
    expect(
      await readSession(failed.root, failed.launch.record.session)
    ).toMatchObject({ ended: "error", exitCode: 3 });
  });

  it("exports TMX_SESSION to Pi and what Pi runs", async () => {
    const {
      root: dir,
      launch,
      running,
    } = await launchFake(["--print-env", "--exit", "0"]);
    await running;
    const seen = await waitForFile(join(dir, "fake-pi-env.json"));
    expect(seen).toEqual({
      pi: launch.record.session,
      child: launch.record.session,
    });
  });

  it("keeps one file per launch, so resumed sessions don't overwrite", async () => {
    const first = await launchFake(["--exit", "0"]);
    await first.running;
    const second = await planLaunch(
      ["--exercise", "02.1"],
      repoRoot,
      {},
      plain
    );
    await launchPi(
      {
        ...second,
        cli: join(fixtures, "fake-pi.ts"),
        args: ["--exit", "0"],
        ownSessionId: null,
      },
      first.root
    );
    const records = await readSessions(first.root);
    expect(records.map((r: SessionRecord) => r.session)).toEqual([
      first.launch.record.session,
      second.record.session,
    ]);
    expect(new Set(records.map((r) => r.piSessionId)).size).toBe(1);
  });

  it("skips a record that doesn't parse instead of hiding the rest", async () => {
    const { root: dir, running } = await launchFake(["--exit", "0"]);
    await running;
    await writeFile(join(sessionsDir(dir), "ses_bad_000000000000.json"), "{");
    expect(await readSessions(dir)).toHaveLength(1);
  });
});

describe("creating Pi's session quietly", () => {
  let home: string | undefined;

  afterEach(async () => {
    if (home !== undefined) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  async function scratch() {
    home = await mkdtemp(join(tmpdir(), "tmx-quiet-"));
    const project = join(home, "project");
    await mkdir(project);
    const env = { PI_CODING_AGENT_DIR: join(home, "agent") };
    return { project, env };
  }

  // The pinned Pi with no model and no key: it opens the session, then stops
  // with "No API key found". A clean env, so a key on this machine can't
  // turn it into a real model call; stdin closed, so it doesn't wait on it.
  const runPi = (cwd: string, env: Record<string, string>, id: string) =>
    spawnSync(
      process.execPath,
      [piCliPath(repoRoot), "--offline", "--session-id", id, "-p", "hi"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
        env: {
          PATH: process.env["PATH"] ?? "",
          HOME: dirname(env.PI_CODING_AGENT_DIR ?? cwd),
          PI_SKIP_VERSION_CHECK: "1",
          ...env,
        },
      }
    ).stderr;

  it("writes one header-only file per new session, and none for one that exists", async () => {
    const { project, env } = await scratch();
    const parent = await createPiSessionQuietly(project, "tmx-02.2-main", env);
    const [a, b] = await Promise.all([
      createPiSessionQuietly(project, freshSessionId("tmx-02.2-main"), env),
      createPiSessionQuietly(project, freshSessionId("tmx-02.2-main"), env),
    ]);
    const files = [parent, a, b];
    expect(files.every((f) => f !== null)).toBe(true);
    expect(new Set(files).size).toBe(3);
    expect(JSON.parse(await readFile(parent ?? "", "utf8"))).toMatchObject({
      type: "session",
      id: "tmx-02.2-main",
    });
    expect(
      await createPiSessionQuietly(project, "tmx-02.2-main", env)
    ).toBeNull();
  });

  it("stops Pi's 'No project session found' warning and leaves the rest alone", async () => {
    const { project, env } = await scratch();
    const loud = await runPi(project, env, "tmx-loud");
    expect(loud).toMatch(/No project session found with id 'tmx-loud'/);
    await createPiSessionQuietly(project, "tmx-quiet", env);
    const quiet = await runPi(project, env, "tmx-quiet");
    expect(quiet).not.toMatch(/No project session found/);
    // Pi still says what else is wrong: here, that it has no model.
    expect(quiet.trim()).not.toBe("");
  });
});

async function waitForFile(path: string): Promise<unknown> {
  for (let i = 0; i < 100; i += 1) {
    try {
      return JSON.parse(await readFile(path, "utf8"));
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`${path} never appeared`);
}

describe("pnpm pi CLI", () => {
  it("prints usage for a bad flag", async () => {
    const result = await promisify(execFile)(
      process.execPath,
      [join(starter, "scripts", "pi.ts"), "--role"],
      { cwd: starter }
    ).then(
      () => ({ code: 0, stderr: "" }),
      (error: { code: number; stderr: string }) => error
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/needs a value/);
    expect(result.stderr).toMatch(/Usage: pnpm pi/);
  });
});
