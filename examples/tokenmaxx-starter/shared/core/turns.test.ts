import { appendFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { observeTurns } from "./turns-observer.ts";
import { readTurns, turnsPath } from "./turns.ts";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "tmx-turns-")));
afterAll(() => rmSync(scratch, { recursive: true }));

type Handler = (event: never) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler>();
  return {
    on: ((event: string, handler: Handler) => {
      handlers.set(event, handler);
      return () => undefined;
    }) as never,
    fire: (event: string, payload: unknown) =>
      handlers.get(event)?.(payload as never),
  };
}

describe("the prompt record", () => {
  it("notes starts, prompts by source and !commands, never their text", async () => {
    const session = "ses_test_000000000000";
    const path = turnsPath(scratch, session);
    const pi = fakePi();
    let t = 0;
    observeTurns(pi, path, () => new Date(Date.UTC(2026, 10, 10, 18, 0, t++)));
    pi.fire("session_start", { reason: "startup" });
    expect(
      pi.fire("input", { text: "secret plan", source: "extension" })
    ).toEqual({ action: "continue" });
    pi.fire("input", { text: "is it done?", source: "interactive" });
    pi.fire("user_bash", { command: "pnpm ex 02.2 status" });
    const lines = await readTurns(scratch, session);
    expect(lines).toEqual([
      { at: "2026-11-10T18:00:00.000Z", kind: "start" },
      { at: "2026-11-10T18:00:01.000Z", kind: "prompt", source: "extension" },
      { at: "2026-11-10T18:00:02.000Z", kind: "prompt", source: "interactive" },
      { at: "2026-11-10T18:00:03.000Z", kind: "prompt", source: "user-bash" },
    ]);
    appendFileSync(path, "not json\n");
    expect(await readTurns(scratch, session)).toHaveLength(4);
  });

  it("is null for a session the observer never ran in", async () => {
    expect(await readTurns(scratch, "ses_none_000000000000")).toBeNull();
  });

  it("never throws into Pi when it can't write", () => {
    const pi = fakePi();
    observeTurns(pi, join("/dev/null", "nope", "x.jsonl"));
    expect(() => pi.fire("session_start", {})).not.toThrow();
  });
});
