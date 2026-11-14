import { Effect, Schema } from "effect";

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

export const cloudflareWorkerSizeLimitBytes = 64 * 1024 * 1024;

export interface StartupSizes {
  readonly entryBytes: number;
  readonly javascriptBytes: number;
  readonly startupBytes: number;
}

const signed = (delta: number) => (delta >= 0 ? `+${delta}` : `${delta}`);

const percentOfLimit = (bytes: number) =>
  ((bytes / cloudflareWorkerSizeLimitBytes) * 100).toFixed(1);

export const startupReport = (
  worker: string,
  sizes: StartupSizes,
  previous: StartupSizes | undefined
) => {
  const change =
    previous === undefined
      ? "no previous run to compare"
      : `static startup ${signed(sizes.startupBytes - previous.startupBytes)} bytes, upload ${signed(sizes.javascriptBytes - previous.javascriptBytes)} bytes since the last run`;

  return {
    line: `${worker} entry: ${sizes.entryBytes} bytes; static startup: ${sizes.startupBytes} bytes; JavaScript upload: ${sizes.javascriptBytes} bytes, ${percentOfLimit(sizes.javascriptBytes)}% of Cloudflare's ${cloudflareWorkerSizeLimitBytes}-byte Worker limit; ${change}`,
    warning:
      sizes.javascriptBytes > cloudflareWorkerSizeLimitBytes / 2
        ? `${worker}'s JavaScript upload is ${sizes.javascriptBytes} bytes, over half of Cloudflare's ${cloudflareWorkerSizeLimitBytes}-byte Worker limit. Cloudflare refuses uploads past the limit. Fix: move page data into static assets or split the Worker before it gets there; \`apps/site/STARTUP.md\` shows how to inspect the chunks.`
        : undefined,
  };
};

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
