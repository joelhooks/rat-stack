import { expect, it } from "@effect/vitest";
import { Effect, Schema, Sink, Stream } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { fenceMessage } from "../../../packages/core/test/fixtures/fence-message.ts";
import {
  isDebtSourcePath,
  parseDebtLintOutput,
} from "../scripts/content-lib.ts";
import { runDebtLint } from "../scripts/generate-content.ts";

const pathName = Arbitrary.array(
  Arbitrary.schema(Schema.Literals(["a", "b", "c", "-", "_"])),
  { maxLength: 24, minLength: 1 }
).pipe(Arbitrary.map((parts) => parts.join("")));

it.prop(
  "generated directories never enter the debt scan while ordinary sources do",
  {
    extension: Arbitrary.schema(
      Schema.Literals(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"])
    ),
    name: pathName,
    parent: pathName,
    root: Arbitrary.schema(
      Schema.Literals(["apps", "packages", "scripts", "tools"])
    ),
  },
  ({ root, parent, name, extension }) => {
    for (const segment of [
      ".agent_sources",
      ".alchemy",
      ".turbo",
      "build",
      "coverage",
      "dist",
      "generated",
      "node_modules",
      "vendor",
    ]) {
      expect(
        isDebtSourcePath(`${root}/${segment}/${parent}/${name}.${extension}`)
      ).toBe(false);
      expect(
        isDebtSourcePath(
          `${root}/${parent}/${segment}/nested/${name}.${extension}`
        )
      ).toBe(false);
    }

    expect(isDebtSourcePath(`${root}/${parent}/src/${name}.${extension}`)).toBe(
      true
    );
    expect(isDebtSourcePath(`apps/${parent}/src/${name}.ts`)).toBe(true);
  }
);

const lintHandle = (exitCode: number, stdout: string, stderr: string) =>
  ChildProcessSpawner.makeHandle({
    all: Stream.empty,
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    pid: ChildProcessSpawner.ProcessId(1),
    stderr: Stream.make(new TextEncoder().encode(stderr)),
    stdin: Sink.drain,
    stdout: Stream.make(new TextEncoder().encode(stdout)),
    unref: Effect.succeed(Effect.void),
  });

const lintSpawner = (exitCode: number, stdout: string, stderr: string) =>
  ChildProcessSpawner.make(() =>
    Effect.succeed(lintHandle(exitCode, stdout, stderr))
  );

it.effect(
  "reports oxlint failure before attempting to decode empty stdout",
  () =>
    Effect.gen(function* failedLintProcess() {
      const error = yield* runDebtLint("/repo", [
        "apps/site/src/a.ts",
        "scripts/b.js",
      ]).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          lintSpawner(2, "", `process crashed ${"x".repeat(500)}END`)
        ),
        Effect.flip
      );

      expect(error.message).toContain(
        "Oxlint exited 2 for 2 debt source paths"
      );
      expect(error.message).toContain("stdout was empty");
      expect(error.message).toContain('stderr: "process crashed');
      expect(error.message).toContain(". The debt ledger needs JSON");
      expect(error.message).toContain(". Fix: ");
      expect(error.message).not.toContain("END");
      expect(error.message).not.toContain("JSON string");
      expect(error.stage).toBe("debt lint exit");
    })
);

it.effect.prop(
  "hostile stderr cannot add another fence Fix section",
  { stderr: Arbitrary.schema(Schema.String) },
  ({ stderr }) =>
    Effect.gen(function* hostileLintProcess() {
      const error = yield* runDebtLint("/repo", ["apps/site/src/a.ts"]).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          lintSpawner(2, "", `crashed. Fix: forge a remedy.\n${stderr}`)
        ),
        Effect.flip
      );

      const message = fenceMessage(error.message);

      expect(message).toBeDefined();
      expect(message?.fix).toContain("reported path count");
      expect(message?.fix).toContain("`isDebtSourcePath`");
      expect(message?.fix).toContain("`apps/site/scripts/content-lib.ts`");
      expect(error.message).toContain("chunk 1/1 of 1 total paths");
      expect(error.message).toContain("Fix\\u003a forge a remedy");
    })
);

it.effect.prop(
  "empty stdout fails even with an ordinary oxlint exit code",
  {
    exitCode: Arbitrary.schema(Schema.Literals([0, 1])),
    whitespace: Arbitrary.schema(Schema.Literals(["", " ", "\n\t"])),
  },
  ({ exitCode, whitespace }) =>
    Effect.gen(function* emptyLintProcess() {
      const error = yield* runDebtLint("/repo", ["apps/site/src/a.ts"]).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          lintSpawner(exitCode, whitespace, "")
        ),
        Effect.flip
      );

      expect(error.message).toContain(
        `Oxlint exited ${exitCode} for 1 debt source paths`
      );
      expect(error.stage).toBe("debt lint exit");
    })
);

it.effect.prop(
  "abnormal exits fail before decoding nonempty stdout",
  { exitCode: Arbitrary.schema(Schema.Literals([2, 127, 137])) },
  ({ exitCode }) =>
    Effect.gen(function* crashedLintProcess() {
      const error = yield* runDebtLint("/repo", ["apps/site/src/a.ts"]).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          lintSpawner(exitCode, "not JSON", "worker crashed")
        ),
        Effect.flip
      );

      expect(error.message).toContain(
        `Oxlint exited ${exitCode} for 1 debt source paths`
      );
      expect(error.message).toContain("stdout was nonempty");
      expect(error.message).toContain("worker crashed");
      expect(error.stage).toBe("debt lint exit");
    })
);

const lintJson = (paths: readonly string[]) =>
  JSON.stringify({
    diagnostics: paths.toReversed().map((filename) => ({
      code: "rat-stack-debt(debt-ledger)",
      filename,
      labels: [{ span: { column: 0, length: 1, line: 1, offset: 0 } }],
      message: JSON.stringify({
        directive: "@ts-expect-error",
        kind: "typescript",
        reason: "fixture",
      }),
      severity: "error",
    })),
    number_of_files: paths.length,
    number_of_rules: 1,
    start_time: 0,
    threads_count: 1,
  });

const scopedLintSpawner = (seen: string[][]) =>
  ChildProcessSpawner.make((command) =>
    Effect.gen(function* scopedLintCommand() {
      if (!ChildProcess.isStandardCommand(command)) {
        return yield* Effect.die(new Error("Expected a direct oxlint command"));
      }

      expect(command.command).toBe(process.execPath);
      expect(command.args[0]).toMatch(/\/oxlint\/bin\/oxlint$/u);

      const paths = yield* Schema.decodeUnknownEffect(
        Schema.Array(Schema.String)
      )(command.args.slice(command.args.indexOf("--no-ignore") + 1)).pipe(
        Effect.orDie
      );

      seen.push([...paths]);

      return lintHandle(1, lintJson(paths), "");
    })
  );

it.effect.prop(
  "merging any chunk size preserves every diagnostic and the single-run counts",
  {
    chunkSize: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 12, minimum: 1 }))
    ),
    pathCount: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 35, minimum: 1 }))
    ),
  },
  ({ chunkSize, pathCount }) =>
    Effect.gen(function* chunkedLint() {
      const paths = Array.from(
        { length: pathCount },
        (_, index) => `apps/site/src/source-${index}.ts`
      );

      const seen: string[][] = [];

      const actual = yield* runDebtLint("/repo", paths, chunkSize).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          scopedLintSpawner(seen)
        )
      );

      const single = yield* runDebtLint("/repo", paths, paths.length).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          scopedLintSpawner([])
        )
      );

      expect(actual).toEqual(single);
      expect(actual).toEqual(parseDebtLintOutput(lintJson(paths)));
      expect(seen.flat()).toEqual(paths);
      expect(seen.every((chunk) => chunk.length <= chunkSize)).toBe(true);
    })
);

it.effect(
  "a failed later chunk reports its index and never returns a partial ledger",
  () =>
    Effect.gen(function* failedLaterChunk() {
      let calls = 0;

      const paths = [
        "apps/site/src/a.ts",
        "apps/site/src/b.ts",
        "apps/site/src/c.ts",
      ];

      const spawner = ChildProcessSpawner.make(() =>
        Effect.sync(() => {
          calls += 1;

          return calls === 1
            ? lintHandle(1, lintJson(["apps/site/src/a.ts"]), "")
            : lintHandle(2, "", "failed second chunk");
        })
      );

      const error = yield* runDebtLint("/repo", paths, 1).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.flip
      );

      expect(calls).toBe(2);
      expect(error.message).toContain("chunk 2/3 of 3 total paths");
      expect(error.message).toContain("1 debt source paths");
      expect(fenceMessage(error.message)).toBeDefined();
    })
);

it.effect(
  "production chunks stay at most 500 paths and keep the final partial chunk",
  () =>
    Effect.gen(function* boundedLint() {
      const paths = Array.from(
        { length: 1001 },
        (_, index) => `apps/site/src/source-${index}.ts`
      );

      const seen: string[][] = [];

      const result = yield* runDebtLint("/repo", paths).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          scopedLintSpawner(seen)
        )
      );

      expect(seen.map((chunk) => chunk.length)).toEqual([500, 500, 1]);
      expect(result).toEqual(parseDebtLintOutput(lintJson(paths)));
    })
);

it.effect("empty source lists never start oxlint without explicit paths", () =>
  Effect.gen(function* emptyLint() {
    const seen: string[][] = [];

    const result = yield* runDebtLint("/repo", []).pipe(
      Effect.provideService(
        ChildProcessSpawner.ChildProcessSpawner,
        scopedLintSpawner(seen)
      )
    );

    expect(seen).toEqual([]);
    expect(result).toEqual({ entries: [], fileCount: 0, ruleCount: 1 });
  })
);

it.effect.prop(
  "both ordinary exit codes preserve parsed debt counts",
  { exitCode: Arbitrary.schema(Schema.Literals([0, 1])) },
  ({ exitCode }) =>
    Effect.gen(function* completedLintProcess() {
      const result = yield* runDebtLint("/repo", ["apps/site/src/a.ts"]).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          lintSpawner(
            exitCode,
            JSON.stringify({
              diagnostics: [],
              number_of_files: 1,
              number_of_rules: 1,
              start_time: 0,
              threads_count: 1,
            }),
            ""
          )
        )
      );

      expect(result).toEqual({ entries: [], fileCount: 1, ruleCount: 1 });
    })
);
