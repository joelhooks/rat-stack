import { Effect, Option, RcRef, Scope, Semaphore } from "effect";
import type { Duration } from "effect";

export interface ConnectionLeaseOptions<C, E> {
  readonly acquire: Effect.Effect<C, E, Scope.Scope>;
  readonly idleTimeToLive: Duration.Input;
}

export interface ConnectionLease<C, E> {
  readonly use: <A, E2, R2>(
    query: (connection: C) => Effect.Effect<A, E2, R2>
  ) => Effect.Effect<A, E | E2, Exclude<R2, Scope.Scope>>;
}

export const connectionLease = Effect.fnUntraced(function* connectionLease<
  C,
  E,
>(options: ConnectionLeaseOptions<C, E>) {
  const leasesByExecution = new WeakMap<Scope.Scope, RcRef.RcRef<C, E>>();
  const leaseCreation = yield* Semaphore.make(1);

  const leaseFor = (execution: Scope.Scope) =>
    leaseCreation.withPermit(
      Effect.suspend(() => {
        const existing = leasesByExecution.get(execution);

        if (existing !== undefined) {
          return Effect.succeed(existing);
        }

        return RcRef.make({
          acquire: options.acquire,
          idleTimeToLive: options.idleTimeToLive,
        }).pipe(
          Scope.provide(execution),
          Effect.tap((lease) =>
            Effect.sync(() => leasesByExecution.set(execution, lease))
          )
        );
      })
    );

  const use: ConnectionLease<C, E>["use"] = (query) =>
    Effect.gen(function* useLeasedConnection() {
      const execution = yield* Effect.serviceOption(Scope.Scope);

      const connection = Option.isNone(execution)
        ? options.acquire
        : leaseFor(execution.value).pipe(Effect.flatMap(RcRef.get));

      return yield* connection.pipe(Effect.flatMap(query), Effect.scoped);
    });

  return { use } satisfies ConnectionLease<C, E>;
});
