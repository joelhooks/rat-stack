import { expect, it } from "@effect/vitest";
import { Deferred, Effect, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { boundedTraversal } from "./fixtures/wiki/bounded-traversal.js";

const Traversal = Schema.Struct({
  concurrency: Schema.Literals([1, 2, 3, 4]),
  count: Schema.Literals([1, 2, 3, 4, 5, 6, 7, 8]),
});

it.effect.prop(
  "traversal never exceeds its supplied bound and preserves input order",
  { scenario: Arbitrary.schema(Traversal) },
  ({ scenario }) =>
    Effect.gen(function* traversalBound() {
      const observed = yield* boundedTraversal(scenario);
      expect(observed.maximum).toBeGreaterThan(0);
      expect(observed.maximum).toBeLessThanOrEqual(scenario.concurrency);
      expect(observed.active).toBe(0);
      expect(observed.results).toEqual(
        Array.from({ length: scenario.count }, (_, index) => index)
      );
    })
);

it.effect(
  "closing the owner interrupts scoped child work before returning",
  () =>
    Effect.gen(function* childOwnership() {
      const started = yield* Deferred.make<boolean>();
      const interrupted = yield* Ref.make(0);
      yield* Effect.scoped(
        Effect.gen(function* ownChild() {
          yield* Deferred.succeed(started, true).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Ref.update(interrupted, (count) => count + 1)
            ),
            Effect.forkScoped
          );
          yield* Deferred.await(started);
        })
      );
      expect(yield* Ref.get(interrupted)).toBe(1);
    })
);
