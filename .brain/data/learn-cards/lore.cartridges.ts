import { Context, Effect, Layer } from "effect";

export class RunLog extends Context.Service<
  RunLog,
  { readonly record: (run: string) => Effect.Effect<void> }
>()("myapp/RunLog") {
  static readonly layer = Layer.succeed(
    RunLog,
    RunLog.of({ record: (run) => Effect.log(`d1 stores ${run}`) })
  );

  static readonly postgres = Layer.succeed(
    RunLog,
    RunLog.of({ record: (run) => Effect.log(`postgres stores ${run}`) })
  );
}

const inspect = Effect.gen(function* recordRun() {
  const log = yield* RunLog;
  yield* log.record("inspect README.md");
});

export const onD1 = inspect.pipe(Effect.provide(RunLog.layer));

export const onPostgres = inspect.pipe(Effect.provide(RunLog.postgres));
