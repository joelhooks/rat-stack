import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Deferred,
  Layer,
  Effect,
  FileSystem,
  Path,
  Redacted,
  Result,
  Schema,
} from "effect";
import { TestConsole } from "effect/testing";

import {
  backfillFiles,
  BackfillInputError,
  backfillSender,
  listBackfillInputs,
  reportBackfillFailure,
  runBackfill,
} from "../src/Backfill.ts";

const firstFile = "2026-01-01-github.jsonl";

const decisionsFile = "2026-01-01-decisions.jsonl";

const laterFile = "2026-01-02-github.jsonl";

const fixture = Effect.gen(function* fixture() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped();

  return {
    dir,
    write: (file: string, rows: readonly object[]) =>
      fs.writeFileString(
        path.join(dir, file),
        rows.map((row) => JSON.stringify(row)).join("\n")
      ),
  };
});

const repo = (key: number) => `test-org/repo-${key}`;

const item = (key: number) => `https://github.com/${repo(key)}`;

const sighting = (key: number) => ({ kind: "github", repo: repo(key) });

const id = (file: string, line: number) => `cafe-backfill:v1:${file}:${line}`;

const keys = Schema.Array(Schema.Natural.check(Schema.isLessThan(12))).check(
  Schema.isMaxLength(250)
);

it.live.prop(
  "keeps each item's API calls in file order while bounding concurrent calls across items",
  { suffix: Arbitrary.schema(keys) },
  ({ suffix }) =>
    Effect.gen(function* dispatchOrder() {
      const { dir, write } = yield* fixture;
      const source = [0, 0, 1, 2, 3, ...suffix];
      yield* write(firstFile, source.map(sighting));
      yield* write(
        decisionsFile,
        source.map((key, index) => ({
          id: item(key),
          source: "github",
          decision: index % 2 === 0 ? "kept" : "dropped",
          why: "Synthetic decision",
        }))
      );

      const observed = new Map<string, string[]>();
      const versions = new Map<string, number>();
      const inFlight = new Set<string>();
      const anotherItemStarted = yield* Deferred.make<boolean>();
      let peak = 0;

      const record = Effect.fnUntraced(function* record(
        target: string,
        commandId: string
      ) {
        expect(inFlight.has(target)).toBe(false);
        inFlight.add(target);
        peak = Math.max(peak, inFlight.size);
        const calls = observed.get(target) ?? [];
        calls.push(commandId);
        observed.set(target, calls);

        if (commandId === id(firstFile, 1)) {
          yield* Deferred.await(anotherItemStarted);
        } else if (commandId === id(firstFile, 3)) {
          yield* Deferred.succeed(anotherItemStarted, true);
        }

        yield* Effect.yieldNow;
        inFlight.delete(target);

        const version = (versions.get(target) ?? 0) + 1;
        versions.set(target, version);

        return { reply: undefined, stream: `Item/${target}`, version };
      });

      const api = {
        ItemHistory: {
          snapshot: () => Effect.succeed({ cursor: 0, state: null }),
        },
        RecordSighting: (target, _input, options) =>
          record(target, options?.commandId ?? "missing"),
        Keep: (target, _input, options) =>
          record(target, options?.commandId ?? "missing"),
        Drop: (target, _input, options) =>
          record(target, options?.commandId ?? "missing"),
      } satisfies Parameters<typeof backfillSender>[0];

      const inputs = yield* listBackfillInputs(dir);

      const summary = yield* backfillFiles(dir, inputs, {
        concurrency: 3,
        send: backfillSender(api, Redacted.make("test-operator-token")),
      });

      for (const key of new Set(source)) {
        const positions = source.flatMap((target, index) =>
          target === key ? [index + 1] : []
        );

        expect(observed.get(item(key))).toEqual([
          ...positions.map((line) => id(firstFile, line)),
          ...positions.map((line) => id(decisionsFile, line)),
        ]);
      }

      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(3);
      expect(summary.delivery?.sent).toBe(source.length * 2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  { arbitrary: { runs: 25 } }
);

it.effect.each([
  { defect: new TypeError("fetch failed"), detail: "TypeError: fetch failed" },
  {
    defect: new Error(
      'Bearer test-operator-token; {"repo":"test-org/repo-1"}',
      { cause: Redacted.make("another-secret") }
    ),
    detail: "Error: Untrusted message withheld",
  },
])(
  "prints a safe partial summary and fails when a sender defects",
  ({ defect, detail }) =>
    Effect.gen(function* partialSummary() {
      const { dir, write } = yield* fixture;
      yield* write(firstFile, [sighting(1), sighting(1), sighting(1)]);
      yield* write(laterFile, [sighting(2)]);
      const inputs = yield* listBackfillInputs(dir);
      const calls: string[] = [];

      const exit = yield* runBackfill(dir, inputs, {
        send: (command) =>
          Effect.suspend(() => {
            calls.push(command.commandId);

            return command.commandId === id(firstFile, 2)
              ? Effect.die(defect)
              : Effect.succeed(Result.succeed("sent"));
          }),
      }).pipe(Effect.tapError(reportBackfillFailure), Effect.exit);

      const stdout = yield* TestConsole.logLines;
      const stderr = yield* TestConsole.errorLines;

      expect(exit._tag).toBe("Failure");
      expect(calls).toEqual([id(firstFile, 1), id(firstFile, 2)]);
      expect(stdout).toEqual([expect.stringContaining('"sent": 1')]);
      expect(stdout[0]).toEqual(
        expect.stringContaining(`"file": "${firstFile}"`)
      );
      expect(stdout[0]).toEqual(
        expect.stringContaining(`"firstIncompleteFile": "${firstFile}"`)
      );
      expect(stdout[0]).not.toEqual(expect.stringContaining(laterFile));
      expect(stderr).toEqual([
        `Backfill stopped unexpectedly at ${firstFile}:2. ${detail}. Fix: check the summary and operator Api, then rerun from the earliest incomplete file with \`--from <file>\`.`,
      ]);
      expect(JSON.stringify([stdout, stderr])).not.toMatch(
        /test-operator-token|test-org\/repo-1|another-secret/u
      );
    }).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, TestConsole.layer))
    )
);

it.live(
  "resumes at the exact file in import order without delivering the skipped prefix",
  () =>
    Effect.gen(function* resume() {
      const { dir, write } = yield* fixture;
      yield* write(firstFile, [sighting(0)]);
      yield* write(laterFile, [sighting(0)]);
      yield* write(decisionsFile, [
        {
          id: item(0),
          source: "github",
          decision: "kept",
          why: "Synthetic decision",
        },
      ]);
      const inputs = yield* listBackfillInputs(dir, laterFile);
      const calls: string[] = [];

      const report = yield* backfillFiles(dir, inputs, {
        send: (command) =>
          Effect.sync(() => {
            calls.push(command.commandId);

            return Result.succeed("sent");
          }),
      });

      expect(report.skippedFiles).toEqual([firstFile]);
      expect(calls).toEqual([id(laterFile, 1), id(decisionsFile, 1)]);
      expect(
        yield* listBackfillInputs(dir, `./${laterFile}`).pipe(Effect.flip)
      ).toBeInstanceOf(BackfillInputError);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
