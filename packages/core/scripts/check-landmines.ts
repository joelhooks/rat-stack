import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  baselineDrift,
  budgetFindings,
  budgetRuleIds,
  growthWithoutReason,
  readBaseline,
} from "../../../tools/oxlint/landmines/baseline.ts";

class LandminesCheckFailed extends Schema.TaggedError<
  LandminesCheckFailed,
  { readonly brand: unique symbol }
>()("LandminesCheckFailed", { message: Schema.String }) {}

const baselinePath = "tools/oxlint/landmines/baseline.json";

const run = Effect.fn("runLandminesCheckCommand")(function* runCommand(
  cwd: string,
  program: string,
  args: readonly string[]
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const output = yield* Effect.scoped(
    Effect.gen(function* capture() {
      const handle = yield* spawner.spawn(
        ChildProcess.make(program, args, { cwd })
      );

      const [stdout, stderr, status] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: "unbounded" }
      );

      return { status, stderr, stdout };
    })
  );

  if (output.status !== 0) {
    return yield* new LandminesCheckFailed({
      message: `\`${program}\` exited ${output.status} during the Landmines check. Partial results cannot prove the baseline. Fix: inspect the output and rerun \`pnpm check:landmines\`.\n${output.stderr}\n${output.stdout}`,
    });
  }

  return output.stdout;
});

const baseBaseline = Effect.fn("readLandminesBase")(function* readBase(
  root: string,
  ref: string
) {
  if (!/^[0-9a-f]{40}$/u.test(ref)) {
    return yield* new LandminesCheckFailed({
      message:
        "LANDMINES_BASE is not a commit SHA. The fence needs the exact PR base. Fix: set `LANDMINES_BASE` to the base commit SHA.",
    });
  }

  const object = yield* run(root, "git", [
    "ls-tree",
    "--name-only",
    ref,
    "--",
    baselinePath,
  ]);

  return object.trim() === baselinePath
    ? readBaseline(yield* run(root, "git", ["show", `${ref}:${baselinePath}`]))
    : {};
});

const check = Effect.gen(function* checkLandmines() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../..");

  const base = yield* Config.String("LANDMINES_BASE").pipe(
    Config.withDefault("")
  );

  const output = yield* run(root, process.execPath, [
    "node_modules/oxlint/bin/oxlint",
    "--config",
    "oxlint.config.ts",
    "-A",
    "all",
    ...budgetRuleIds.flatMap((id) => ["-W", `landmines/${id}`]),
    "--format",
    "json",
  ]);

  const baseline = readBaseline(
    yield* fs.readFileString(path.join(root, baselinePath))
  );

  const drift = baselineDrift(baseline, budgetFindings(output));

  if (base !== "") {
    drift.push(
      ...growthWithoutReason(yield* baseBaseline(root, base), baseline)
    );
  }

  return yield* drift.length === 0
    ? Effect.void
    : new LandminesCheckFailed({ message: drift.join("\n") });
});

NodeRuntime.runMain(check.pipe(Effect.provide(NodeServices.layer)));
