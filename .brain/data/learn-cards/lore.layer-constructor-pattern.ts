import { Context, Effect, Layer, Ref } from "effect";

export class Counter extends Context.Service<
  Counter,
  { readonly increment: Effect.Effect<number> }
>()("myapp/Counter") {
  static readonly layer = Layer.effect(
    Counter,
    Effect.gen(function* makeCounter() {
      const count = yield* Ref.make(0);

      return Counter.of({ increment: Ref.updateAndGet(count, (n) => n + 1) });
    })
  );
}

const program = Effect.gen(function* countTwice() {
  const counter = yield* Counter;
  yield* counter.increment;

  return yield* counter.increment;
});

export const main = program.pipe(Effect.provide(Counter.layer));
