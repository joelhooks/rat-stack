import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Schema } from "effect";

import { WorkerBundle } from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";
import {
  feedbackAuthBuild,
  feedbackGatewayBuild,
} from "../src/auth/build-options.ts";
import { PublicAuthBundleLeak } from "./startup-auth-dependency.ts";
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
    worker: Schema.Literals(["Mischief", "LearnFeedbackAuth"]),
  }
) {}

const measureWorker = Effect.fn("measureWorker")(function* measureWorker(
  worker: "Mischief" | "LearnFeedbackAuth"
) {
  const fs = yield* FileSystem.FileSystem;
  const bundler = yield* WorkerBundle;

  const durableObject = {
    constructor: Effect.succeed(Effect.succeed({})),
    kind: "durableObject" as const,
    services: Context.empty(),
  };

  const directory =
    worker === "Mischief" ? "dist/startup" : "dist/startup-auth";

  const main =
    worker === "Mischief"
      ? "../src/worker.ts"
      : "../src/auth/private-worker.ts";

  const exports: Record<string, typeof durableObject> = {};

  if (worker === "Mischief") {
    Object.assign(exports, {
      Interest: durableObject,
      InterestIndex: durableObject,
      LegacyMcp: durableObject,
    });
  }

  const bundle = yield* bundler.build({
    compatibility: { date: "2026-05-28", flags: ["nodejs_compat"] },
    entry: {
      exports,
      kind: "effect",
    },
    extraOptions: {
      ...(worker === "Mischief" ? feedbackGatewayBuild : feedbackAuthBuild),
      bundleAnalyzer: { fileName: "analysis.json", format: "json" },
      output: { dir: directory },
    },
    id: worker,
    main: new URL(main, import.meta.url).pathname,
    stack: { name: "RatStack", stage: "prod" },
  });

  const graph = yield* Schema.decodeEffect(BundleGraph)(
    yield* fs.readFileString(`${directory}/analysis.json`)
  );

  const modules = graph.modules.map((module) => module.path);
  yield* assertBuildOnlyModules(modules);

  if (worker === "Mischief") {
    const authModules = modules.filter((path) =>
      /(?:^|\/)packages\/auth\/(?:dist|src)\/|(?:^|\/)better-auth(?:@|\/)|(?:^|\/)@better-auth\//u.test(
        path
      )
    );

    if (authModules.length > 0) {
      return yield* new PublicAuthBundleLeak({ modules: authModules });
    }
  }

  yield* fs.makeDirectory(directory, { recursive: true });

  for (const file of bundle.files) {
    const blob = new Blob([file.content]);

    const bytes = new Uint8Array(
      yield* Effect.promise(blob.arrayBuffer.bind(blob))
    );

    yield* fs.writeFile(`${directory}/${file.path}`, bytes);
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
    `${directory}/worker.bundle`,
    new Uint8Array(yield* Effect.promise(upload.arrayBuffer.bind(upload)))
  );

  const bytes = new Blob([entry.content]).size;

  const javascriptBytes = bundle.files
    .filter((file) => file.path.endsWith(".js"))
    .reduce((total, file) => total + new Blob([file.content]).size, 0);

  yield* Effect.log(
    `${worker} entry: ${bytes} bytes; budget: ${entryBudgetBytes}; complete JS upload: ${javascriptBytes} bytes; budget: ${javascriptBudgetBytes}`
  );

  if (bytes > entryBudgetBytes) {
    return yield* new StartupBudgetExceeded({
      budget: entryBudgetBytes,
      bytes,
      scope: "entry",
      worker,
    });
  }

  if (javascriptBytes > javascriptBudgetBytes) {
    return yield* new StartupBudgetExceeded({
      budget: javascriptBudgetBytes,
      bytes: javascriptBytes,
      scope: "javascript-upload",
      worker,
    });
  }

  yield* fs.writeFileString(
    `${directory}/metrics.json`,
    JSON.stringify({
      entryBudgetBytes,
      entryBytes: bytes,
      javascriptBudgetBytes,
      javascriptBytes,
      worker,
    })
  );

  return { entryBytes: bytes, javascriptBytes, worker };
});

const program = Effect.validate(
  ["Mischief", "LearnFeedbackAuth"] as const,
  measureWorker
);

await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));
