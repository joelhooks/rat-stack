import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { readerHomeFlags } from "../../mischief/scripts/reader-home-flags.ts";
import { ReaderFlags, readerInit } from "../src/client/reader-model.ts";
import { readerView } from "../src/features/reader.ts";

const program = Effect.gen(function* renderHomePrototype() {
  const fs = yield* FileSystem.FileSystem;
  const input = yield* readerHomeFlags("https://reader-prototype.invalid");
  const flags = yield* Schema.decodeUnknownEffect(ReaderFlags)(input);

  const rendered = yield* renderToString(
    { Flags: ReaderFlags, init: readerInit, view: readerView },
    {
      flags,
      isHydratable: false,
    }
  );

  yield* fs.writeFileString(
    "/tmp/foldkit-site-a-home-prototype.html",
    rendered.html
  );
  yield* Console.log(
    `Foldkit home prototype: ${rendered.html.length} bytes; ${flags.blocks.length} typed human-source blocks; generation ${flags.page.generation}`
  );

  return rendered;
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
