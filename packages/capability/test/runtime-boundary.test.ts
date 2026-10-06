import { expect, it } from "@effect/vitest";
import { Effect, Ref, Result } from "effect";

import { makeForeignRuntimeBoundary } from "./fixtures/wiki/foreign-runtime-boundary.js";

it.effect(
  "a foreign boundary builds once, closes once, and refuses reuse",
  () =>
    Effect.gen(function* runtimeLifetime() {
      const acquired = yield* Ref.make(0);
      const released = yield* Ref.make(0);
      yield* Effect.acquireUseRelease(
        Effect.sync(() => makeForeignRuntimeBoundary({ acquired, released })),
        (boundary) =>
          Effect.gen(function* useForeignBoundary() {
            expect(yield* Ref.get(acquired)).toBe(0);
            expect(yield* Effect.tryPromise(boundary.read)).toBe("ready");
            expect(yield* Effect.tryPromise(boundary.read)).toBe("ready");
            expect(yield* Ref.get(acquired)).toBe(1);
            yield* Effect.promise(boundary.close);
            yield* Effect.promise(boundary.close);
            expect(yield* Ref.get(released)).toBe(1);

            const reused = yield* Effect.tryPromise(boundary.read).pipe(
              Effect.result
            );

            expect(Result.isFailure(reused)).toBe(true);
          }),
        (boundary) => Effect.promise(boundary.close)
      );
    })
);
