import { WorkerBundle } from "@alchemy.run/cloudflare/Workers/Sources/Rolldown";
import { NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Schema } from "effect";

import {
  feedbackAuthBuild,
  feedbackGatewayBuild,
} from "../src/auth/build-options.ts";
import { PublicAuthBundleLeak } from "./startup-auth-dependency.ts";
import { assertBuildOnlyModules } from "./startup-build-dependency.ts";
import {
  assertStartupBudget,
  measureStartupSet,
  StartupGraph,
} from "./startup-set.ts";

const BundleGraph = Schema.fromJsonString(
  Schema.Struct({
    ...StartupGraph.fields,
    modules: Schema.Array(Schema.Struct({ path: Schema.String })),
  })
);

const startupBudgets = {
  LearnFeedbackAuth: 1_456_000,
  Mischief: 1_247_000,
};

const javascriptAlarmBytes = 2_500_000;

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

  const entryBytes = new Blob([entry.content]).size;

  const files = bundle.files
    .filter((file) => file.path.endsWith(".js"))
    .map((file) => ({
      bytes: new Blob([file.content]).size,
      path: file.path,
    }));

  const javascriptBytes = files.reduce((total, file) => total + file.bytes, 0);
  const startup = yield* measureStartupSet(files, graph, entry.path);
  const startupBudgetBytes = startupBudgets[worker];

  const metrics = {
    entryBytes,
    javascriptAlarmBytes,
    javascriptBytes,
    ...startup,
    startupBudgetBytes,
    worker,
  };

  yield* Effect.log(
    `${worker} entry: ${entryBytes} bytes; static startup: ${startup.startupBytes} bytes; shrink-only ceiling: ${startupBudgetBytes}; complete JS upload (alarm only): ${javascriptBytes} bytes`
  );

  if (javascriptBytes > javascriptAlarmBytes) {
    yield* Effect.logWarning(
      `${worker} complete JS upload exceeds ${javascriptAlarmBytes} bytes; inspect dynamic chunks and content growth; startup alone gates code size`
    );
  }

  yield* fs.writeFileString(
    `${directory}/metrics.json`,
    JSON.stringify(metrics)
  );
  yield* assertStartupBudget(startup.startupBytes, startupBudgetBytes, worker);

  return metrics;
});

const program = Effect.validate(
  ["Mischief", "LearnFeedbackAuth"] as const,
  measureWorker
);

await Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer)));
