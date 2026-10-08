import { Effect } from "effect";

const fetchPage = (id: number) => Effect.succeed(`page ${id}`);

export const pages = Effect.forEach([1, 2, 3, 4, 5, 6], fetchPage, {
  concurrency: 2,
});

export const owned = Effect.scoped(
  Effect.gen(function* fetchWithWatcher() {
    yield* Effect.never.pipe(
      Effect.onInterrupt(() => Effect.log("watcher stopped")),
      Effect.forkScoped
    );

    return yield* pages;
  })
);
