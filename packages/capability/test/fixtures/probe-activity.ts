import { Context, Effect, Layer, Ref } from "effect";

export class ProbeActivity extends Context.Service<
  ProbeActivity,
  {
    readonly around: <A, E, R>(
      run: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>;
    readonly read: (
      reset: boolean
    ) => Effect.Effect<{ readonly active: number; readonly peak: number }>;
  }
>()("test/ProbeActivity") {
  static readonly layer = Layer.effect(
    ProbeActivity,
    Effect.gen(function* makeProbeActivity() {
      const state = yield* Ref.make({ active: 0, peak: 0 });

      return ProbeActivity.of({
        around: (run) =>
          Ref.update(state, ({ active, peak }) => ({
            active: active + 1,
            peak: Math.max(peak, active + 1),
          })).pipe(
            Effect.andThen(run),
            Effect.ensuring(
              Ref.update(state, ({ active, peak }) => ({
                active: active - 1,
                peak,
              }))
            )
          ),
        read: (reset) =>
          Ref.modify(
            state,
            (current) =>
              [
                current,
                reset
                  ? { active: current.active, peak: current.active }
                  : current,
              ] as const
          ),
      });
    })
  );
}
