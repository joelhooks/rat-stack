import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type ExerciseContext, exerciseContext } from "../core/context.ts";
import { pidAlive, readSessions } from "../core/sessions.ts";
import { isolatedStarter } from "../core/testing.ts";
import { cast } from "./cast.ts";
import {
  descendants,
  type EnvState,
  spawnHost,
  stopEnv,
  waitForEnv,
} from "./environment.ts";
import { replyFor, stepIndex, streamFor } from "./scripted-model.ts";
import { parkedPath } from "./stand-ins.ts";

describe("the scripted model", () => {
  it("answers each request with the step after the last user message", () => {
    const script = [{ text: "one" }, { text: "two" }];
    const body = (roles: string[]) => ({
      messages: roles.map((role) => ({ role, content: "" })),
    });
    expect(stepIndex(body(["system", "user"]))).toBe(0);
    expect(stepIndex(body(["user", "assistant", "toolResult"]))).toBe(1);
    expect(stepIndex(body(["user", "assistant", "user"]))).toBe(0);
    expect(replyFor(script, body(["user", "assistant", "assistant"]))).toEqual({
      text: "Nothing more to do here.",
    });
  });

  it("streams a tool call as one chunk", () => {
    const stream = streamFor({ tool: "bash", args: { command: "ls" } }, "c1");
    expect(stream).toContain('"finish_reason":"tool_calls"');
    expect(stream).toContain('"arguments":"{\\"command\\":\\"ls\\"}"');
  });
});

/** The messages in a Pi session file, oldest first. */
function messages(
  file: string
): { role?: string; stopReason?: string; content?: unknown }[] {
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { type?: string; message?: object })
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message as { role?: string });
}

// Five real Pis on the scripted model, through the real launcher, in a copy
// of the starter (`isolatedStarter`), so the guest's own `.pi` here never
// loads. Pi's session files go to a temp dir; the launcher's records go to
// the copy's `.workshop-state/sessions/` and are removed when the set stops.
describe("the environment's sessions (live, no model)", () => {
  let cleanup: () => Promise<void> = async () => undefined;
  let ctx: ExerciseContext;
  let stateDir = "";
  let piDir = "";
  let first: EnvState;
  const saved = { ...process.env };

  beforeAll(async () => {
    const starter = await isolatedStarter();
    stateDir = await mkdtemp(join(tmpdir(), "tmx-05.1-state-"));
    ctx = exerciseContext({
      exerciseId: "05.1",
      repoRoot: starter.root,
      env: { TMX_STATE_DIR: stateDir },
    });
    piDir = await mkdtemp(join(tmpdir(), "tmx-05.1-pi-"));
    process.env["PI_CODING_AGENT_SESSION_DIR"] = piDir;
    process.env["TMX_STATE_DIR"] = stateDir;
    // As if run from inside the guest's Pi: the cast must still be top-level.
    process.env["TMX_SESSION"] = "ses_mwgo0000_000000000000";
    cleanup = async () => {
      await stopEnv(stateDir);
      process.env = saved;
      await starter.cleanup();
      await rm(stateDir, { recursive: true, force: true });
      await rm(piDir, { recursive: true, force: true });
    };
    const run = spawnHost(ctx, 120_000);
    first = await waitForEnv(stateDir, run, ["ready"], 90_000);
  }, 100_000);

  afterAll(() => cleanup(), 60_000);

  const fileOf = (name: string) => {
    const file = readdirSync(piDir).find((f) =>
      f.endsWith(`_tmx-05.1-${name}.jsonl`)
    );
    if (file === undefined) {
      throw new Error(`no session file for ${name}`);
    }
    return join(piDir, file);
  };
  const sessionOf = (name: string) => {
    const s = first.sessions.find((x) => x.name === name);
    if (s?.session == null || s.pid === null) {
      throw new Error(`${name} has no session`);
    }
    return s;
  };

  it("starts all five, top-level, each with its own Pi", async () => {
    expect(first.status).toBe("ready");
    expect(first.sessions.map((s) => s.name)).toEqual(cast.map((r) => r.name));
    const records = await readSessions(ctx.repoRoot);
    for (const role of cast) {
      const s = sessionOf(role.name);
      const record = records.find((r) => r.session === s.session);
      expect(record?.parentSession).toBeNull();
      expect(record?.piSessionId).toBe(`tmx-05.1-${role.name}`);
    }
  });

  it("holds kiwi in a long bash call, with the command running", () => {
    const last = messages(fileOf("kiwi")).at(-1);
    expect(last?.stopReason).toBe("toolUse");
    expect(JSON.stringify(last?.content)).toContain("sleep 3600");
    expect(pidAlive(sessionOf("kiwi").pid ?? -1)).toBe(true);
    expect(descendants(sessionOf("kiwi").pid ?? -1).length).toBeGreaterThan(0);
  });

  it("ends lark's turn on a question", () => {
    const last = messages(fileOf("lark")).at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.stopReason).toBe("stop");
    expect(JSON.stringify(last?.content)).toMatch(/\?"/);
    expect(pidAlive(sessionOf("lark").pid ?? -1)).toBe(true);
  });

  it("parks moth on a wait and newt on a message, each noted on disk", () => {
    for (const [name, tool] of [
      ["moth", "await_condition"],
      ["newt", "message_session"],
    ] as const) {
      const tail = messages(fileOf(name)).slice(-3);
      expect(JSON.stringify(tail[0]?.content)).toContain(tool);
      expect(tail[1]?.role).toBe("toolResult");
      expect(tail[2]?.stopReason).toBe("stop");
      expect(JSON.stringify(tail[2]?.content)).not.toMatch(/\?"/);
      expect(pidAlive(sessionOf(name).pid ?? -1)).toBe(true);
    }
    const parked = readFileSync(parkedPath(stateDir), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { kind: string; session: string });
    expect(parked.map((p) => [p.kind, p.session]).toSorted()).toEqual(
      [
        ["message", sessionOf("newt").session],
        ["wait", sessionOf("moth").session],
      ].toSorted()
    );
  });

  it("kills orca mid tool call, and its launcher records the signal", async () => {
    const orca = sessionOf("orca");
    expect(pidAlive(orca.pid ?? -1)).toBe(false);
    expect(messages(fileOf("orca")).at(-1)?.stopReason).toBe("toolUse");
    const record = (await readSessions(ctx.repoRoot)).find(
      (r) => r.session === orca.session
    );
    expect(record?.ended).toBe("signal");
    expect(record?.exitSignal).toBe("SIGKILL");
  });

  it("stops them all, removes only its own records, and resumes the same conversations next run", async () => {
    const stopped = await stopEnv(stateDir);
    expect(stopped?.status).toBe("stopped");
    const records = await readSessions(ctx.repoRoot);
    for (const s of first.sessions) {
      expect(pidAlive(s.pid ?? -1)).toBe(false);
      expect(records.some((r) => r.session === s.session)).toBe(false);
    }
    const files = readdirSync(piDir).toSorted();
    expect(files).toHaveLength(5);

    const second = await waitForEnv(
      stateDir,
      spawnHost(ctx, 120_000),
      ["ready"],
      90_000
    );
    expect(second.status).toBe("ready");
    expect(readdirSync(piDir).toSorted()).toEqual(files);
    expect(existsSync(fileOf("lark"))).toBe(true);
    expect(
      messages(fileOf("lark")).filter((m) => m.role === "user")
    ).toHaveLength(2);
    // Each run's tool calls are new calls, never paired with an old result.
    const ids = messages(fileOf("kiwi")).flatMap((m) =>
      m.role === "assistant" && Array.isArray(m.content)
        ? m.content.flatMap((c: { type?: string; id?: string }) =>
            c.type === "toolCall" && c.id !== undefined ? [c.id] : []
          )
        : []
    );
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(messages(fileOf("kiwi")).at(-1)?.stopReason).toBe("toolUse");
  }, 120_000);
});
