import { Context, Effect, Layer } from "effect";

import { SourceFault } from "./errors/source-fault.ts";
import type { Repository } from "./repositories.ts";

export class SourceRepository extends Context.Service<
  SourceRepository,
  {
    readonly repositories: readonly Repository[];
    readonly resolve: (
      repo: string,
      commit: string,
      path: string
    ) => Effect.Effect<string, SourceFault>;
  }
>()("code-snippets/SourceRepository") {
  static memory = (
    entries: readonly Repository[],
    blobs: ReadonlyMap<string, string>,
    unavailable = false
  ) =>
    Layer.succeed(
      SourceRepository,
      SourceRepository.of({
        repositories: entries,
        resolve: (repo, commit, path) => {
          if (!entries.some((entry) => entry.id === repo)) {
            return Effect.fail(new SourceFault({ kind: "repo" }));
          }

          if (unavailable) {
            return Effect.fail(new SourceFault({ kind: "unavailable" }));
          }

          const text = blobs.get(`${repo}:${commit}:${path}`);

          if (text !== undefined) {
            return Effect.succeed(text);
          }

          return Effect.fail(
            new SourceFault({
              kind: [...blobs.keys()].some((key) =>
                key.startsWith(`${repo}:${commit}:`)
              )
                ? "path"
                : "commit",
            })
          );
        },
      })
    );
}
