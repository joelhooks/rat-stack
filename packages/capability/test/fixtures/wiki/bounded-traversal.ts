import { Effect, Ref } from "effect";

export const boundedTraversal = Effect.fnUntraced(
  function* boundedTraversal(options: {
    readonly concurrency: number;
    readonly count: number;
  }) {
    const activity = yield* Ref.make({ active: 0, maximum: 0 });
    const input = Array.from({ length: options.count }, (_, index) => index);

    const results = yield* Effect.forEach(
      input,
      (index) =>
        Effect.acquireUseRelease(
          Ref.update(activity, (state) => ({
            active: state.active + 1,
            maximum: Math.max(state.maximum, state.active + 1),
          })),
          () => Effect.yieldNow.pipe(Effect.andThen(Effect.succeed(index))),
          () =>
            Ref.update(activity, (state) => ({
              ...state,
              active: state.active - 1,
            }))
        ),
      { concurrency: options.concurrency }
    );

    return { ...(yield* Ref.get(activity)), results };
  }
);
