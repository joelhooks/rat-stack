import { expect, it } from "@effect/vitest";
import { CardSchema, LearnError } from "@rat-stack/core/learn";
import { Deferred, Effect, Fiber, Layer, Ref, Result, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { Learner } from "../../../packages/learn/src/learner.js";

it.effect.prop(
  "overlapping deck misses read in each request and later hits reuse completed values",
  { cards: Arbitrary.schema(Schema.Array(CardSchema)) },
  ({ cards }) =>
    Effect.gen(function* overlappingDeckMisses() {
      const calls = yield* Ref.make(0);
      const entered = yield* Deferred.make<boolean>();
      const release = yield* Deferred.make<boolean>();

      const deck = Effect.gen(function* loadDeck() {
        const call = yield* Ref.updateAndGet(calls, (count) => count + 1);

        if (call === 1) {
          yield* Deferred.succeed(entered, true);
          yield* Deferred.await(release);
        }

        return cards;
      });

      const services = yield* Layer.build(Learner.layer(deck));
      const learner = yield* Learner.pipe(Effect.provideContext(services));
      const first = yield* Effect.forkChild(learner.deck);
      yield* Deferred.await(entered);
      const second = yield* Effect.forkChild(learner.deck);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(release, true);

      expect(yield* Fiber.join(first)).toStrictEqual(cards);
      expect(yield* Fiber.join(second)).toStrictEqual(cards);
      expect(yield* Ref.get(calls)).toBe(2);
      expect(yield* learner.deck).toStrictEqual(cards);
      expect(yield* Ref.get(calls)).toBe(2);
    })
);

it.effect.prop(
  "failed deck reads leave no completed cache entry",
  { cards: Arbitrary.schema(Schema.Array(CardSchema)) },
  ({ cards }) =>
    Effect.gen(function* failedDeckReads() {
      const calls = yield* Ref.make(0);

      const deck = Effect.gen(function* loadDeck() {
        const call = yield* Ref.updateAndGet(calls, (count) => count + 1);

        return call === 1
          ? yield* new LearnError({
              id: "deck",
              reason: "temporary deck failure",
            })
          : cards;
      });

      const services = yield* Layer.build(Learner.layer(deck));
      const learner = yield* Learner.pipe(Effect.provideContext(services));

      expect(Result.isFailure(yield* Effect.result(learner.deck))).toBe(true);
      expect(yield* learner.deck).toStrictEqual(cards);
      expect(yield* learner.deck).toStrictEqual(cards);
      expect(yield* Ref.get(calls)).toBe(2);
    })
);
