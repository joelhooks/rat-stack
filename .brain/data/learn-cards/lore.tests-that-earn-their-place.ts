import { expect, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";

export class Prices extends Context.Service<
  Prices,
  { readonly withTax: (cents: number) => Effect.Effect<number> }
>()("myapp/Prices") {
  static readonly layer = Layer.succeed(
    Prices,
    Prices.of({ withTax: (cents) => Effect.succeed(Math.round(cents * 1.1)) })
  );
}

it.effect("adds ten percent tax", () =>
  Effect.gen(function* taxOnOneDollar() {
    const prices = yield* Prices;

    expect(yield* prices.withTax(100)).toBe(110);
  }).pipe(Effect.provide(Prices.layer))
);
