import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  contextFromEnv,
  type ExerciseContext,
  exerciseContext,
  findRepoRoot,
} from "./context.ts";
import { defineExercise } from "./exercise.ts";
import { inputFixtureLineCount, inputFixturePath } from "./fixtures.ts";
import {
  newRunId,
  parseResultId,
  parseRunId,
  resultIdFor,
  sha256,
} from "./ids.ts";
import {
  exists,
  readJson,
  StoreError,
  tryReadJson,
  writeJsonAtomic,
} from "./store.ts";
import { tempContext } from "./testing.ts";

let ctx: ExerciseContext;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ ctx, cleanup } = await tempContext());
});

afterEach(async () => {
  await cleanup();
});

describe("ids", () => {
  it("makes a unique run id per call", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRunId()));
    expect(ids.size).toBe(200);
  });

  it("content-addresses results by run and bytes", () => {
    const run = newRunId();
    const id = resultIdFor(run, "oak\npine\n");
    const expected = sha256(`${run}\0oak\npine\n`).slice(0, 16);
    expect(id).toBe(`res_${expected}`);
    expect(resultIdFor(run, Buffer.from("oak\npine\n"))).toBe(id);
    expect(resultIdFor(newRunId(), "oak\npine\n")).not.toBe(id);
  });

  it("rejects malformed ids", () => {
    expect(() => parseRunId("run-1")).toThrow(/matching the RegExp/);
    expect(() => parseResultId("res_xyz")).toThrow(/matching the RegExp/);
  });
});

describe("context", () => {
  it("defaults the state dir under .workshop-state", () => {
    const repoRoot = findRepoRoot();
    const c = exerciseContext({ exerciseId: "02.1", repoRoot, env: {} });
    expect(c.stateDir).toBe(join(repoRoot, ".workshop-state", "02.1"));
  });

  it("honours TMX_STATE_DIR", () => {
    const c = exerciseContext({
      exerciseId: "02.1",
      repoRoot: "/r",
      env: { TMX_STATE_DIR: "/tmp/x" },
    });
    expect(c.stateDir).toBe("/tmp/x");
  });

  it("reads the launcher env", () => {
    const c = contextFromEnv({ TMX_EXERCISE: "02.1" }, "/r");
    expect(c).toMatchObject({
      exerciseId: "02.1",
      stateDir: "/r/.workshop-state/02.1",
    });
    expect(() => contextFromEnv({}, "/r")).toThrow(/TMX_EXERCISE/);
  });
});

describe("store", () => {
  const Shape = Schema.Struct({ n: Schema.Number });

  it("round-trips through an atomic write", async () => {
    const path = join(ctx.stateDir, "a", "b.json");
    await writeJsonAtomic(path, { n: 1 });
    expect(await readJson(path, Shape)).toEqual({ n: 1 });
    expect(await exists(path)).toBe(true);
    expect(await readdir(join(ctx.stateDir, "a"))).toEqual(["b.json"]);
  });

  it("fails typed on missing, unparseable and off-schema files", async () => {
    const path = join(ctx.stateDir, "x.json");
    await expect(readJson(path, Shape)).rejects.toMatchObject({
      _tag: "StoreError",
      reason: "missing",
    });
    await writeFile(path, "{not json");
    await expect(readJson(path, Shape)).rejects.toMatchObject({
      reason: "unparseable",
    });
    await writeFile(path, JSON.stringify({ n: "one" }));
    const outcome = await tryReadJson(path, Shape);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error).toBeInstanceOf(StoreError);
    expect(!outcome.ok && outcome.error.reason).toBe("invalid");
  });
});

describe("exercise and fixtures", () => {
  it("reserves the test command", () => {
    const noop = async () => 0;
    expect(() =>
      defineExercise({
        id: "9",
        title: "x",
        commands: { setup: noop, status: noop, test: noop },
      })
    ).toThrow(/reserved/);
  });

  it("ships the two-line input fixture", async () => {
    const text = await readFile(inputFixturePath(ctx), "utf8");
    expect(text).toBe("oak\npine\n");
    expect(text.split("\n").length - 1).toBe(inputFixtureLineCount);
  });
});
