import { expect, it } from "@effect/vitest";
import { Effect, Schema, Sink, Stream } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { ChildProcessSpawner } from "effect/process";

import { isDebtSourcePath } from "../scripts/content-lib.ts";
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

const lintSpawner = (exitCode: number, stdout: string, stderr: string) =>
  ChildProcessSpawner.make(() =>
    Effect.succeed(
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
      })
    )
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
