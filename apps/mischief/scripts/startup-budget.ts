import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Schema } from "effect";

import { WorkerBundle } from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";

const entryBudgetBytes = 10_000_000;

class StartupBudgetExceeded extends Schema.TaggedError<StartupBudgetExceeded>()(
  "StartupBudgetExceeded",
  { budget: Schema.Finite, bytes: Schema.Finite }
) {}

const program = Effect.gen(function* measureMischiefBundle() {
  const fs = yield* FileSystem.FileSystem;
  const bundler = yield* WorkerBundle;

  const durableObject = {
    constructor: Effect.succeed(Effect.succeed({})),
    kind: "durableObject" as const,
    services: Context.empty(),
  };

  const bundle = yield* bundler.build({
    compatibility: { date: "2026-05-28", flags: ["nodejs_compat"] },
    entry: {
      exports: {
        Interest: durableObject,
        InterestIndex: durableObject,
        LegacyMcp: durableObject,
      },
      kind: "effect",
    },
    extraOptions: {
      bundleAnalyzer: { fileName: "analysis.json", format: "json" },
      output: { dir: "dist/startup" },
    },
    id: "Mischief",
    main: new URL("../src/worker.ts", import.meta.url).pathname,
    stack: { name: "RatStack", stage: "prod" },
  });

  yield* fs.makeDirectory("dist/startup", { recursive: true });

  for (const file of bundle.files) {
    const blob = new Blob([file.content]);

    const bytes = new Uint8Array(
      yield* Effect.promise(blob.arrayBuffer.bind(blob))
    );

    yield* fs.writeFile(`dist/startup/${file.path}`, bytes);
  }

  const [entry] = bundle.files;
  const form = new FormData();

  form.set(
    "metadata",
    JSON.stringify({
      compatibility_date: "2026-05-28",
      compatibility_flags: ["nodejs_compat"],
      main_module: entry.path,
    })
  );

  for (const file of bundle.files) {
    if (file.path.endsWith(".js")) {
      form.set(
        file.path,
        new Blob([file.content], { type: "application/javascript+module" }),
        file.path
      );
    }
  }

  const upload = new Response(form);

  yield* fs.writeFile(
    "dist/startup/worker.bundle",
    new Uint8Array(yield* Effect.promise(upload.arrayBuffer.bind(upload)))
  );

  const bytes = new Blob([entry.content]).size;

  yield* Effect.log(
    `Mischief entry: ${bytes} bytes; budget: ${entryBudgetBytes}`
  );

  if (bytes > entryBudgetBytes) {
    return yield* new StartupBudgetExceeded({
      budget: entryBudgetBytes,
      bytes,
    });
  }

  return bytes;
});

await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));
