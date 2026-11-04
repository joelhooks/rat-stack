import { Context, Effect, FiberSet, Layer, Option, Ref } from "effect";

import type { WatchReceipt } from "./watch-receipt.js";

export type WatchLifecycle<R> = Effect.Effect<
  Option.Option<WatchReceipt>,
  never,
  R
>;

export interface WatchHostService {
  readonly hold: <R>(
    lifecycle: WatchLifecycle<R>
  ) => Effect.Effect<void, never, R>;
  readonly pending: Effect.Effect<number>;
  readonly settle: Effect.Effect<readonly WatchReceipt[]>;
}

const inline: WatchHostService = {
  hold: (lifecycle) => Effect.asVoid(lifecycle),
  pending: Effect.succeed(0),
  settle: Effect.succeed([]),
};

export const WatchHost = Context.Reference<WatchHostService>(
  "@rat-stack/deploy/WatchHost",
  { defaultValue: () => inline }
);

export const lingeringWatchHost = Layer.effect(
  WatchHost,
  Effect.gen(function* makeLingeringWatchHost() {
    const running = yield* FiberSet.make<Option.Option<WatchReceipt>>();
    const settled = yield* Ref.make<readonly WatchReceipt[]>([]);

    return {
      hold: <R>(lifecycle: WatchLifecycle<R>) =>
        FiberSet.run(
          running,
          lifecycle.pipe(
            Effect.tap(
              Option.match({
                onNone: () => Effect.void,
                onSome: (receipt) =>
                  Ref.update(settled, (rows) => [...rows, receipt]),
              })
            )
          )
        ).pipe(Effect.asVoid),
      pending: FiberSet.size(running),
      settle: FiberSet.awaitEmpty(running).pipe(
        Effect.andThen(Ref.get(settled))
      ),
    } satisfies WatchHostService;
  })
);
