import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Array,
  Console,
  Effect,
  FileSystem,
  Order,
  Path,
  Schema,
} from "effect";

import { prepareReaderSiteInputs } from "../../mischief/scripts/reader-site-inputs.ts";
import { ReaderMetadata, ReaderRouteLedger } from "../src/page-descriptor.ts";
import { isReaderRoutePath } from "../src/reader-routes.ts";

const program = Effect.gen(function* emitReaderLedger() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const inputs = yield* prepareReaderSiteInputs;

  const routes = inputs.pages.flatMap(({ html: _html, ...page }) => {
    const prompt =
      page.path === "/prompts" || page.path.startsWith("/prompts/");

    const included = isReaderRoutePath(page.path);

    const markdownAvailability = prompt
      ? "included"
      : "representation-not-projected";

    const preview = {
      representation: included ? "html" : "none",
      status: included ? 200 : 404,
    };

    return [
      {
        ...page,
        preview: {
          ...preview,
          availability: included ? "included" : "outside-slice",
        },
        representation: "html",
      },
      {
        ...page,
        preview: {
          ...preview,
          availability: included ? markdownAvailability : "outside-slice",
          representation: prompt ? "markdown" : preview.representation,
        },
        representation: "markdown",
      },
    ];
  });

  const errorTemplate = yield* fs
    .readFileString(
      new URL("../dist/reader-error.json", import.meta.url).pathname
    )
    .pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(
            Schema.Struct({
              page: Schema.Struct({
                page: Schema.Struct({
                  metadata: ReaderMetadata,
                  sourcePath: Schema.String,
                }),
              }),
            })
          )
        )
      )
    );

  const errorRoutes = [
    ...["/no-verify", "/--no-verify"].map((path) => ({
      code: 403,
      message: "The rat looks disappointed.",
      path,
      title: "Forbidden",
    })),
    {
      code: 404,
      message: "That bin got pulled out.",
      path: "/*",
      title: "Not found",
    },
  ].flatMap((errorPage) => {
    const { metadata, sourcePath } = errorTemplate.page.page;

    const filled = (text: string) =>
      text
        .replace("ERROR_CODE", String(errorPage.code))
        .replace("ERROR_TITLE", errorPage.title)
        .replace("ERROR_MESSAGE", errorPage.message);

    const route = {
      metadata: {
        ...metadata,
        description: filled(metadata.description),
        title: filled(metadata.title),
      },
      path: errorPage.path,
      sourcePath,
      status: errorPage.code,
    };

    return [
      {
        ...route,
        preview: {
          availability: "included",
          representation: "html",
          status: errorPage.code,
        },
        representation: "html",
      },
      {
        ...route,
        preview: {
          availability: "representation-not-projected",
          representation: "html",
          status: errorPage.code,
        },
        representation: "markdown",
      },
    ];
  });

  const ledger = yield* Schema.decodeUnknownEffect(ReaderRouteLedger)({
    anchorAdditions: [],
    deliberateChanges: [
      {
        location: "/lore/services-capture-dependencies",
        path: "/lore/services-capture-dependencies/",
        previewStatus: 307,
        productionStatus: 404,
        reason:
          "Desk accepts the trailing-slash redirect to the bare canonical as an improvement; real-edge qualification at cef413e confirms the bare route returns 200 without Location.",
      },
    ],
    generation: inputs.generation,
    routes: Array.sort(
      [...routes, ...errorRoutes],
      Order.Struct({ path: Order.String, representation: Order.String })
    ),
  });

  const output = new URL("../dist/reader-routes.json", import.meta.url)
    .pathname;

  yield* fs.makeDirectory(paths.dirname(output), { recursive: true });
  yield* fs.writeFileString(output, `${JSON.stringify(ledger, null, 2)}\n`);
  yield* Console.log(
    `Reader ledger: ${ledger.routes.length} representations; generation ${ledger.generation}`
  );

  return ledger;
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
