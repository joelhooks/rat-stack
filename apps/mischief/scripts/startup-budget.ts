import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Schema } from "effect";

import { WorkerBundle } from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";
import { assertBuildOnlyModules } from "./startup-build-dependency.ts";

const BundleGraph = Schema.fromJsonString(
  Schema.Struct({
    modules: Schema.Array(Schema.Struct({ path: Schema.String })),
  })
);

const entryBudgetBytes = 900_000;

const javascriptBudgetBytes = 2_500_000;

class StartupBudgetExceeded extends Schema.TaggedError<StartupBudgetExceeded>()(
  "StartupBudgetExceeded",
  {
    budget: Schema.Finite,
    bytes: Schema.Finite,
    scope: Schema.Literals(["entry", "javascript-upload"]),
  }
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

  const graph = yield* Schema.decodeEffect(BundleGraph)(
    yield* fs.readFileString("dist/startup/analysis.json")
  );

  yield* assertBuildOnlyModules(graph.modules.map((module) => module.path));

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

  const javascriptBytes = bundle.files
    .filter((file) => file.path.endsWith(".js"))
    .reduce((total, file) => total + new Blob([file.content]).size, 0);

  yield* Effect.log(
    `Mischief entry: ${bytes} bytes; budget: ${entryBudgetBytes}; complete JS upload: ${javascriptBytes} bytes; budget: ${javascriptBudgetBytes}`
  );

  if (bytes > entryBudgetBytes) {
    return yield* new StartupBudgetExceeded({
      budget: entryBudgetBytes,
      bytes,
      scope: "entry",
    });
  }

  if (javascriptBytes > javascriptBudgetBytes) {
    return yield* new StartupBudgetExceeded({
      budget: javascriptBudgetBytes,
      bytes: javascriptBytes,
      scope: "javascript-upload",
    });
  }

  return bytes;
});

await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));
