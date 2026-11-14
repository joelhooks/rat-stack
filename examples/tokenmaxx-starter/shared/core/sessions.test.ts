import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  endOf,
  newSessionId,
  readSession,
  readSessions,
  type SessionRecord,
  sessionFromEnv,
  sessionStatus,
  writeSession,
} from "./sessions.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "tmx-sessions-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const record = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  session: newSessionId(),
  parentSession: null,
  piSessionId: "tmx-02.1-main",
  pid: 4242,
  role: "main",
  exercise: "02.1",
  startedAt: "2026-11-10T18:00:00.000Z",
  endedAt: null,
  ended: null,
  exitCode: null,
  exitSignal: null,
  ...over,
});

describe("session ids", () => {
  it("are unique and safe as file names", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newSessionId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^ses_[0-9a-z]+_[0-9a-f]{12}$/);
    }
  });

  it("refuses to read a session id that could leave the folder", async () => {
    await expect(readSession(root, "../../etc/passwd")).rejects.toThrow(
      /matching the RegExp/
    );
  });
});

describe("how a session ended", () => {
  it("maps Pi's exit to quit, error or signal", () => {
    expect(endOf({ code: 0, signal: null })).toBe("quit");
    expect(endOf({ code: 1, signal: null })).toBe("error");
    expect(endOf({ code: null, signal: "SIGTERM" })).toBe("signal");
  });

  it("is running or vanished while there's no end record", () => {
    expect(sessionStatus(record(), () => true)).toBe("running");
    expect(sessionStatus(record(), () => false)).toBe("vanished");
    expect(
      sessionStatus(record({ ended: "quit", endedAt: "x" }), () => true)
    ).toBe("quit");
  });
});

describe("TMX_SESSION", () => {
  it("is null in a plain terminal", () => {
    expect(sessionFromEnv({})).toBeNull();
    expect(sessionFromEnv({ TMX_SESSION: "" })).toBeNull();
    expect(sessionFromEnv({ TMX_SESSION: "ses_a_000000000000" })).toBe(
      "ses_a_000000000000"
    );
  });
});

describe("the record store", () => {
  it("rewrites one file per session and lists them oldest first", async () => {
    const late = record({ startedAt: "2026-11-10T18:05:00.000Z" });
    const early = record({ startedAt: "2026-11-10T18:01:00.000Z" });
    await writeSession(root, late);
    await writeSession(root, early);
    await writeSession(root, {
      ...early,
      endedAt: "2026-11-10T18:02:00.000Z",
      ended: "quit",
      exitCode: 0,
    });
    const all = await readSessions(root);
    expect(all.map((r) => r.session)).toEqual([early.session, late.session]);
    expect(all[0]?.ended).toBe("quit");
  });

  it("is empty before any Pi was launched", async () => {
    expect(await readSessions(root)).toEqual([]);
  });
});
