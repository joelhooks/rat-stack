import {
  Console,
  Duration,
  Effect,
  FileSystem,
  Option,
  Path,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export type SpecOutcome =
  | { readonly kind: "pass"; readonly distinct: number }
  | {
      readonly kind: "counterexample";
      readonly exit: number;
      readonly violated: string | undefined;
    }
  | { readonly kind: "notChecked"; readonly reason: string };

export interface SpecRun {
  readonly module: string;
  readonly spec: string;
  readonly cfg: string;
  readonly budget: Duration.Input;
}

const counterexampleExits = new Set([10, 11, 12, 13, 14]);

const finalCount =
  /(?<generated>\d+) states generated, (?<distinct>\d+) distinct states found, (?<queued>\d+) states left on queue\./gu;

const violation =
  /(?:Invariant (?<invariant>\w+) is violated|Temporal property (?<property>\w+) was violated)/u;

const lastLine = (output: string) =>
  output.trim().split("\n").at(-1) ?? "no output";

export const classify = (exit: number, output: string): SpecOutcome => {
  if (counterexampleExits.has(exit)) {
    const named = violation.exec(output);

    return {
      exit,
      kind: "counterexample",
      violated: named?.groups?.invariant ?? named?.groups?.property,
    };
  }

  if (exit !== 0) {
    return {
      kind: "notChecked",
      reason: `tla-ts exited ${exit}: ${lastLine(output)}`,
    };
  }

  const counts = [...output.matchAll(finalCount)].at(-1);

  if (counts?.groups === undefined || counts.groups.queued !== "0") {
    return {
      kind: "notChecked",
      reason: "tla-ts exited 0 without a completed state count",
    };
  }

  return { distinct: Number(counts.groups.distinct), kind: "pass" };
};

export const onlyInvariant = (cfg: string, invariant: string) => {
  const block = /^INVARIANTS?\n(?: {2}\w+\n)+/mu;

  return block.test(cfg)
    ? Option.some(cfg.replace(block, `INVARIANT\n  ${invariant}\n`))
    : Option.none();
};

export const checkSpec = Effect.fn("checkSpec")(function* checkSpec(
  run: SpecRun
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const cli = path.resolve(
    import.meta.dirname,
    "../../node_modules/tla-ts/dist/cli.js"
  );

  const directory = yield* fileSystem.makeTempDirectoryScoped();
  const specFile = path.join(directory, `${run.module}.tla`);
  const cfgFile = path.join(directory, `${run.module}.cfg`);

  yield* fileSystem.writeFileString(specFile, run.spec);
  yield* fileSystem.writeFileString(cfgFile, run.cfg);

  const checked = Effect.gen(function* runChecker() {
    const handle = yield* spawner.spawn(
      ChildProcess.make("node", [cli, "-config", cfgFile, specFile], {
        cwd: directory,
      })
    );

    const [output, exit] = yield* Effect.all(
      [handle.all.pipe(Stream.decodeText, Stream.mkString), handle.exitCode],
      { concurrency: 2 }
    );

    return classify(exit, output);
  }).pipe(Effect.scoped);

  return yield* checked.pipe(
    Effect.timeoutOption(run.budget),
    Effect.map(
      Option.getOrElse((): SpecOutcome => ({
        kind: "notChecked",
        reason: `tla-ts ran past its ${Duration.format(Duration.fromInputUnsafe(run.budget))} budget and was stopped`,
      }))
    ),
    Effect.catch((error) =>
      Effect.succeed<SpecOutcome>({
        kind: "notChecked",
        reason: `tla-ts did not run: ${error.message}`,
      })
    )
  );
}, Effect.scoped);

export const warnNotChecked = (cfg: string, outcome: SpecOutcome) =>
  outcome.kind === "notChecked"
    ? Console.log(`::warning::not checked: ${cfg}: ${outcome.reason}`)
    : Effect.void;
