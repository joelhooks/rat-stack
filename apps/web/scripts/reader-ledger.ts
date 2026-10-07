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
import { ReaderRouteLedger } from "../src/page-descriptor.ts";
import {
  readerBodyRoutePaths,
  readerRoutePaths,
} from "../src/reader-routes.ts";

const program = Effect.gen(function* emitReaderLedger() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const inputs = yield* prepareReaderSiteInputs;

  const routes = inputs.pages.flatMap(({ html: _html, ...page }) => {
    const included =
      readerRoutePaths.includes(page.path) ||
      readerBodyRoutePaths.includes(page.path) ||
      page.path === "/lore" ||
      page.path.startsWith("/lore/");

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
          availability: included
            ? "representation-not-projected"
            : "outside-slice",
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
      routes,
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
