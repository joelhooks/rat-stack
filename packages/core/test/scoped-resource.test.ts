import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Ref, Result } from "effect";

it.effect.each(["success", "failure", "interruption"])(
  "closes an acquired resource exactly once after %s",
  (outcome) =>
    Effect.gen(function* resourceExit() {
      const acquired = yield* Ref.make(0);
      const released = yield* Ref.make(0);
      const started = yield* Deferred.make<boolean>();

      const acquire = Effect.acquireRelease(
        Effect.sync(() => ({ name: "counted-resource" })).pipe(
          Effect.tap(() => Ref.update(acquired, (count) => count + 1)),
          Effect.tap(() => Deferred.succeed(started, true))
        ),
        () => Ref.update(released, (count) => count + 1)
      );

      const use = Effect.scoped(
        Effect.gen(function* useResource() {
          const resource = yield* acquire;
          expect(resource.name).toBe("counted-resource");

          if (outcome === "failure") {
            return yield* Effect.fail("expected-refusal");
          }

          if (outcome === "interruption") {
            return yield* Effect.never;
          }

          return resource.name;
        })
      );

      if (outcome === "interruption") {
        const fiber = yield* Effect.forkChild(use);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(
          true
        );
      } else {
        const result = yield* Effect.result(use);
        expect(Result.isFailure(result)).toBe(outcome === "failure");

        if (Result.isFailure(result)) {
          expect(result.failure).toBe("expected-refusal");
        }
      }

      expect(yield* Ref.get(acquired)).toBe(1);
      expect(yield* Ref.get(released)).toBe(1);
    })
);
