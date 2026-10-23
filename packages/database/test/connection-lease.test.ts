import { expect, it } from "@effect/vitest";
import { Duration, Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { TestClock } from "effect/testing";

import { connectionLease } from "../src/connection-lease.js";
import type { ConnectionLease } from "../src/connection-lease.js";
import { RELEASE_IDLE_POSTGRES_LEASE_AFTER } from "../src/run-log-vendor.js";

const idleMillis = Duration.toMillis(
  Duration.fromInputUnsafe(RELEASE_IDLE_POSTGRES_LEASE_AFTER)
);

const StepSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("query"),
    parallel: Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 1 })),
  }),
  Schema.Struct({
    kind: Schema.Literal("provider"),
    millis: Schema.Int.check(Schema.isBetween({ maximum: 30_000, minimum: 1 })),
  }),
]);

type Step = typeof StepSchema.Type;

const requests = Arbitrary.array(
  Arbitrary.array(Arbitrary.schema(StepSchema), {
    maxLength: 12,
    minLength: 1,
  }),
  { maxLength: 3, minLength: 1 }
);

interface Pool {
  acquired: number;
  open: number;
  peak: number;
}

interface Connection {
  readonly id: number;
}

const runRequest = Effect.fnUntraced(function* runRequest(
  lease: ConnectionLease<Connection, never>,
  pool: Pool,
  steps: readonly Step[]
) {
  const model = { acquired: 0, held: false, idleFor: 0 };

  for (const step of steps) {
    if (step.kind === "query") {
      model.acquired += model.held ? 0 : 1;

      const seen = yield* Effect.all(
        Array.from({ length: step.parallel }, () =>
          lease.use((connection) =>
            Effect.yieldNow.pipe(Effect.as(connection.id))
          )
        ),
        { concurrency: "unbounded" }
      );

      expect(new Set(seen).size).toBe(1);
      model.held = true;
      model.idleFor = 0;
    } else {
      yield* TestClock.adjust(Duration.millis(step.millis));
      yield* Effect.yieldNow;
      model.idleFor += step.millis;
      model.held &&= model.idleFor < idleMillis;
      expect(pool.open).toBe(model.held ? 1 : 0);
    }
  }

  return model.acquired;
}, Effect.scoped);

it.effect.prop(
  "a request never holds its connection across a provider wait longer than the idle lease, and bursts share one connection",
  { requests },
  ({ requests: generated }) =>
    Effect.gen(function* checkLeaseModel() {
      const pool: Pool = { acquired: 0, open: 0, peak: 0 };

      const lease = yield* connectionLease({
        acquire: Effect.acquireRelease(
          Effect.sync((): Connection => {
            pool.acquired += 1;
            pool.open += 1;
            pool.peak = Math.max(pool.peak, pool.open);

            return { id: pool.acquired };
          }),
          () =>
            Effect.sync(() => {
              pool.open -= 1;
            })
        ),
        idleTimeToLive: RELEASE_IDLE_POSTGRES_LEASE_AFTER,
      });

      const expected = { acquired: 0 };

      for (const steps of generated) {
        expected.acquired += yield* runRequest(lease, pool, steps);
        expect(pool.open).toBe(0);
      }

      expect(pool.acquired).toBe(expected.acquired);
      expect(pool.peak).toBeLessThanOrEqual(1);
    }),
  { arbitrary: { runs: 200 } }
);
