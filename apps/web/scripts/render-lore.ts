import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { readerPrototypeFlags } from "../../mischief/scripts/reader-prototype-flags.ts";
import { init } from "../src/client/reader/init.ts";
import { ReaderFlags } from "../src/client/reader/model.ts";
import { serviceCaptureDocument } from "../src/client/service-capture-document.ts";
import { view } from "../src/features/reader.ts";

const program = Effect.gen(function* renderLorePrototype() {
  const fs = yield* FileSystem.FileSystem;
  const input = yield* readerPrototypeFlags("https://reader-prototype.invalid");

  const flags = yield* Schema.decodeUnknownEffect(ReaderFlags)({
    ...input,
    blocks: serviceCaptureDocument,
  });

  const rendered = yield* renderToString(
    { Flags: ReaderFlags, init, view },
    {
      flags,
      isHydratable: false,
    }
  );

  yield* fs.writeFileString(
    "/tmp/foldkit-site-a-lore-prototype.html",
    rendered.html
  );
  yield* Console.log(
    `Foldkit lore prototype: ${rendered.html.length} bytes; ${flags.snippets.length} real built excerpts; generation ${flags.page.generation}`
  );

  return rendered;
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
