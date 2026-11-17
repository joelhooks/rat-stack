import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExerciseContext } from "#shared/core/context.ts";
import type { SessionRecord } from "#shared/core/sessions.ts";
import { tempContext } from "#shared/core/testing.ts";
import type { TurnLine } from "#shared/core/turns.ts";

import { type MessagesDeps, messagesExercise } from "./exercise.ts";
import { eventsDir, newSecret, readEvents } from "./log.ts";
import {
  findTranscript,
  parseTranscript,
  type TranscriptItem,
} from "./transcript.ts";

const record = (session: string, role: string): SessionRecord => ({
  session,
  parentSession: null,
  piSessionId: `tmx-04.1-${role}`,
  pid: 1,
  role,
  exercise: "04.1",
  startedAt: "2026-11-17T18:00:00.000Z",
  endedAt: null,
  ended: null,
  exitCode: null,
  exitSignal: null,
});

describe("the 04.1 commands", () => {
  let ctx: ExerciseContext;
  let cleanup: () => Promise<void>;
  let lines: string[];
  let session: string | null;
  let clock: number;
  let turns: Map<string, TurnLine[]>;
  let transcripts: Map<string, TranscriptItem[]>;
  let committed: boolean;
  const sessions = [record("A", "a"), record("B", "b")];

  const exercise = () => {
    const deps: MessagesDeps = {
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
      now: () => new Date(Date.UTC(2026, 10, 17, 18, 0, (clock += 1))),
      random: Math.random,
      session: () => session,
      readSessions: async () => sessions,
      readTurns: async (_root, s) => turns.get(s) ?? null,
      readTranscript: async (_ctx, r) => transcripts.get(r.session) ?? null,
      commit: async () => ({ name: "committed", ok: committed, detail: "" }),
    };
    return messagesExercise({ id: "04.1", title: "test" }, deps);
  };
  const run = async (command: string, args: string[] = []) => {
    lines = [];
    const code = await exercise().commands[command]?.(ctx, args);
    return { code, text: lines.join("\n") };
  };
  const secretOf = (text: string) =>
    /secret: (\S+)$/m.exec(text)?.[1] ?? "none";

  beforeEach(async () => {
    ({ ctx, cleanup } = await tempContext({ exerciseId: "04.1" }));
    lines = [];
    session = null;
    clock = 0;
    turns = new Map();
    transcripts = new Map();
    committed = true;
  });
  afterEach(async () => cleanup());

  it("stores a secret only as a salted hash", async () => {
    await run("setup");
    session = "B";
    const { text } = await run("secret");
    const secret = secretOf(text);
    expect(secret).toMatch(/^[a-z]+-[a-z]+-\d{4}$/);
    for (const name of await readdir(eventsDir(ctx.stateDir))) {
      const raw = await readFile(join(eventsDir(ctx.stateDir), name), "utf8");
      expect(raw).not.toContain(secret);
    }
    const status = await run("status");
    expect(status.text).not.toContain(secret);
    expect(status.text).toMatch(/secret shown to B \(role b\)/);
  });

  it("hands in another session's secret, in any case", async () => {
    session = "B";
    const secret = secretOf((await run("secret")).text);
    session = "A";
    const handed = await run("answer", [` ${secret.toUpperCase()} `]);
    expect(handed.code).toBe(0);
    expect(handed.text).toMatch(/the secret B \(role b\) was shown at 18:00/);
    const events = await readEvents(ctx.stateDir);
    expect(events.map((e) => e._tag)).toEqual([
      "StartedOver",
      "Revealed",
      "Answered",
    ]);
  });

  it("refuses a session's own secret and an unknown one", async () => {
    session = "A";
    const secret = secretOf((await run("secret")).text);
    expect((await run("answer", [secret])).text).toMatch(/own secret/);
    expect((await run("answer", ["amber-amber-0000"])).code).toBe(1);
    expect((await run("answer")).code).toBe(2);
  });

  it("says when a terminal's secret won't count", async () => {
    expect((await run("secret")).text).toMatch(/doesn't count toward done/);
  });

  it("setup starts over", async () => {
    session = "B";
    const secret = secretOf((await run("secret")).text);
    await run("setup");
    session = "A";
    expect((await run("answer", [secret])).text).toMatch(
      /no session was shown/
    );
  });

  it("done prints PASS lines for a passing story and exits 0", async () => {
    await run("setup");
    turns.set("A", [
      { at: "2026-11-17T18:00:01.500Z", kind: "prompt", source: "interactive" },
    ]);
    turns.set("B", []);
    session = "B";
    const secret = secretOf((await run("secret")).text);
    session = "A";
    await run("answer", [secret]);
    transcripts.set("A", [
      {
        kind: "call",
        at: "2026-11-17T18:00:09.000Z",
        id: "c1",
        tool: "send",
        args: '{"to":"ghost"}',
      },
      {
        kind: "result",
        at: "2026-11-17T18:00:09.000Z",
        callId: "c1",
        tool: "send",
        isError: true,
        text: "no session named ghost",
      },
    ]);
    const done = await run("done");
    expect(done.text.match(/^PASS {5}/gm)).toHaveLength(4);
    expect(done.code).toBe(0);
    committed = false;
    const uncommitted = await run("done");
    expect(uncommitted.text.match(/^FAIL {5}committed/gm)).toHaveLength(1);
    expect(uncommitted.code).toBe(1);
  });

  it("setup marks when the step began, once", async () => {
    await run("setup");
    const first = await readFile(join(ctx.stateDir, "step-start.json"), "utf8");
    await run("setup");
    expect(await readFile(join(ctx.stateDir, "step-start.json"), "utf8")).toBe(
      first
    );
  });

  it("done fails cleanly with nothing done: one line, or every line with --details", async () => {
    const done = await run("done");
    expect(done.code).toBe(1);
    expect(done.text).toMatch(
      /^Not started\. Start it with: pnpm ex 04\.1 setup$/m
    );
    expect(done.text).not.toMatch(/^(PASS|FAIL) /m);
    const all = await run("done", ["--details"]);
    expect(all.code).toBe(1);
    expect(all.text.match(/^FAIL {5}/gm)).toHaveLength(3);
    expect(all.text.match(/^PASS {5}committed/gm)).toHaveLength(1);
  });
});

describe("newSecret", () => {
  it("is two words and four digits", () => {
    expect(newSecret(() => 0)).toBe("amber-amber-0000");
    expect(newSecret(() => 0.999)).toBe("thistle-thistle-9990");
  });
});

describe("Pi's session file", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tmx-transcript-"));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  const lines = [
    {
      type: "session",
      version: 3,
      id: "tmx-04.1-a",
      timestamp: "t0",
      cwd: "/x",
    },
    {
      type: "message",
      timestamp: "2026-11-17T18:00:01.000Z",
      message: { role: "user", content: "send to ghost", timestamp: 1 },
    },
    {
      type: "message",
      timestamp: "2026-11-17T18:00:02.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Sending." },
          {
            type: "toolCall",
            id: "c1",
            name: "send_message",
            arguments: { to: "ghost" },
          },
        ],
      },
    },
    {
      type: "message",
      timestamp: "2026-11-17T18:00:03.000Z",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "send_message",
        content: [{ type: "text", text: "nobody is ghost" }],
        isError: true,
      },
    },
    {
      type: "custom_message",
      timestamp: "2026-11-17T18:00:04.000Z",
      customType: "mail",
      content: "bounce",
      display: true,
    },
    "not json",
  ];
  const text = lines
    .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
    .join("\n");

  it("keeps calls, results and messages, never the assistant's words", () => {
    expect(parseTranscript(text)).toEqual([
      {
        kind: "message",
        at: "2026-11-17T18:00:01.000Z",
        role: "user",
        text: "send to ghost",
      },
      {
        kind: "call",
        at: "2026-11-17T18:00:02.000Z",
        id: "c1",
        tool: "send_message",
        args: '{"to":"ghost"}',
      },
      {
        kind: "result",
        at: "2026-11-17T18:00:03.000Z",
        callId: "c1",
        tool: "send_message",
        isError: true,
        text: "nobody is ghost",
      },
      {
        kind: "message",
        at: "2026-11-17T18:00:04.000Z",
        role: "custom",
        text: "bounce",
      },
    ]);
  });

  it("is found by Pi session ID in Pi's sessions folder", async () => {
    const sessions = join(dir, "sessions");
    await mkdir(sessions);
    await writeFile(
      join(sessions, "2026-11-17T18-00-00-000Z_tmx-04.1-a.jsonl"),
      text
    );
    await writeFile(
      join(sessions, "2026-11-17T18-00-00-000Z_tmx-04.1-ab.jsonl"),
      ""
    );
    const env = { PI_CODING_AGENT_SESSION_DIR: sessions };
    expect(await findTranscript("tmx-04.1-a", [dir], env)).toBe(
      join(sessions, "2026-11-17T18-00-00-000Z_tmx-04.1-a.jsonl")
    );
    expect(await findTranscript("tmx-04.1-b", [dir], env)).toBeNull();
  });

  it("is found under the default folder for the cwd Pi ran in", async () => {
    const agent = join(dir, "agent");
    const guest = join(dir, "guest");
    await mkdir(guest);
    const encoded = `--${guest.replace(/^\//, "").replaceAll("/", "-")}--`;
    await mkdir(join(agent, "sessions", encoded), { recursive: true });
    const file = join(agent, "sessions", encoded, "t_tmx-04.1-b.jsonl");
    await writeFile(file, text);
    const env = { PI_CODING_AGENT_DIR: agent };
    expect(
      await findTranscript("tmx-04.1-b", [join(dir, "starter"), guest], env)
    ).toBe(file);
  });

  // macOS's temp folder is behind /var, a symlink to /private/var: Pi names
  // its folder after the cwd it got, the real path or the path as given.
  it.each(["the path as given", "its real path"])(
    "is found through a symlinked path, under the folder named for %s",
    async (named) => {
      const agent = join(dir, "agent");
      const real = join(dir, "real-guest");
      const link = join(dir, "linked-guest");
      await mkdir(real);
      await symlink(real, link);
      const cwd = named === "its real path" ? await realpath(link) : link;
      const encoded = `--${cwd.replace(/^\//, "").replaceAll("/", "-")}--`;
      await mkdir(join(agent, "sessions", encoded), { recursive: true });
      const file = join(agent, "sessions", encoded, "t_tmx-04.1-c.jsonl");
      await writeFile(file, text);
      const env = { PI_CODING_AGENT_DIR: agent };
      expect(await findTranscript("tmx-04.1-c", [link], env)).toBe(file);
    }
  );
});
