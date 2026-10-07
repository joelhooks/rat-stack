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

const program = Effect.gen(function* emitReaderLedger() {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* Path.Path;
  const inputs = yield* prepareReaderSiteInputs;

  const routes = inputs.pages.flatMap(({ html: _html, ...page }) => [
    { ...page, representation: "html" },
    { ...page, representation: "markdown" },
  ]);

  const ledger = yield* Schema.decodeUnknownEffect(ReaderRouteLedger)({
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
