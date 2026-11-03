import { Effect, Schema } from "effect";

import { StartupBudgetExceeded } from "./startup-budget-exceeded.ts";

export const StartupGraph = Schema.Struct({
  chunks: Schema.Array(
    Schema.Struct({
      imports: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            targetChunkIndex: Schema.Int.check(
              Schema.isGreaterThanOrEqualTo(0)
            ),
            type: Schema.Literals(["static", "dynamic"]),
          })
        )
      ),
      name: Schema.String,
    })
  ),
});

export class StartupGraphInvalid extends Schema.TaggedError<
  StartupGraphInvalid,
  { readonly brand: unique symbol }
>()("StartupGraphInvalid", { detail: Schema.String, entry: Schema.String }) {
  override get message() {
    return `The startup graph for ${this.entry} is incomplete: ${this.detail}. Without the full static graph the size gate cannot count startup bytes. Fix: inspect \`analysis.json\` in \`apps/site/dist/startup\` or \`apps/site/dist/startup-auth\`, then rerun \`pnpm --filter @rat-stack/site startup:check\`.`;
  }
}

export const assertStartupBudget = (
  bytes: number,
  budget: number,
  worker: string
) =>
  bytes > budget
    ? Effect.fail(new StartupBudgetExceeded({ budget, bytes, worker }))
    : Effect.void;

export const measureStartupSet = Effect.fn("measureStartupSet")(
  function* measureStartupSet(
    files: readonly { readonly path: string; readonly bytes: number }[],
    graph: typeof StartupGraph.Type,
    entry: string
  ) {
    const entryIndex = graph.chunks.findIndex((chunk) => chunk.name === entry);
    const pending = [entryIndex];
    const visited = new Set<number>();
    const startupFiles: string[] = [];
    let startupBytes = 0;

    while (pending.length > 0) {
      const index = pending.pop();

      if (index === undefined || visited.has(index)) {
        continue;
      }

      visited.add(index);
      const chunk = graph.chunks[index];
      const file = files.find((candidate) => candidate.path === chunk?.name);

      if (!chunk || !file) {
        return yield* new StartupGraphInvalid({
          detail: `static chunk ${index} (${chunk?.name ?? "unknown"}) is absent from the graph or upload`,
          entry,
        });
      }

      startupFiles.push(file.path);
      startupBytes += file.bytes;

      for (const dependency of chunk.imports ?? []) {
        if (dependency.type === "static") {
          pending.push(dependency.targetChunkIndex);
        }
      }
    }

    return { startupBytes, startupFiles: startupFiles.toSorted() };
  }
);
