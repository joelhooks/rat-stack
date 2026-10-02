import { Context, Effect, Layer, Option, Schema } from "effect";

import { sourceLines } from "./model.ts";
import type { CodeRequest } from "./model.ts";
import { SourceRepository } from "./source-repository.ts";

export const DiagnosticsSchema = Schema.Struct({
  line: Schema.Finite,
  message: Schema.String,
  sourcePath: Schema.String,
});

export type Diagnostics = typeof DiagnosticsSchema.Type;

export class Drift extends Context.Service<
  Drift,
  {
    readonly check: (
      request: CodeRequest,
      source: string
    ) => Effect.Effect<readonly Diagnostics[]>;
  }
>()("code-snippets/Drift") {
  static readonly silent = Layer.succeed(
    Drift,
    Drift.of({ check: () => Effect.succeed([]) })
  );
  static readonly layer = Layer.effect(
    Drift,
    Effect.gen(function* makeDrift() {
      const repository = yield* SourceRepository;

      const check = Effect.fn("Drift.check")(function* check(
        request: CodeRequest,
        source: string
      ) {
        if (!request.reference) {
          return [];
        }

        const head = yield* repository
          .resolve(request.repo, "HEAD", request.path)
          .pipe(Effect.option);

        if (Option.isNone(head)) {
          return [
            {
              line: request.line,
              message: `pinned at ${request.commit}; HEAD comparison unavailable; refresh?`,
              sourcePath: request.sourcePath,
            },
          ];
        }

        const previous = sourceLines(source);
        const current = sourceLines(head.value);
        let changed = 0;

        for (const range of request.ranges) {
          for (let line = range.start; line <= range.end; line += 1) {
            if (previous[line - 1] !== current[line - 1]) {
              changed += 1;
            }
          }
        }

        return changed === 0
          ? []
          : [
              {
                line: request.line,
                message: `pinned at ${request.commit}; these lines changed since (${changed} shown lines differ at HEAD); refresh?`,
                sourcePath: request.sourcePath,
              },
            ];
      });

      return Drift.of({ check });
    })
  );
}
