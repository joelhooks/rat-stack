import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem } from "effect";

import { migrationHandPage } from "./migration-hand-page.ts";

NodeRuntime.runMain(
  Effect.gen(function* proveHandDocument() {
    const fs = yield* FileSystem.FileSystem;
    const page = yield* migrationHandPage;
    const root = new URL("../../../", import.meta.url).pathname;

    const live = yield* fs.readFileString(
      `${root}.rat/content-migration/live-page.md`
    );

    const matchesGenerated = page.markdown === page.baseline;
    const matchesLive = page.markdown === live;
    yield* Console.log(
      JSON.stringify(
        {
          bytes: new TextEncoder().encode(page.markdown).length,
          matchesGenerated,
          matchesLive,
          route: page.metadata.routePath,
          sources: page.metadata.bibliography.length,
          terms: page.metadata.terms.length,
        },
        null,
        2
      )
    );

    if (!(matchesGenerated && matchesLive)) {
      return yield* Effect.die(
        new Error("Hand-page parity failed; do not cut over")
      );
    }

    return yield* Effect.void;
  }).pipe(Effect.provide(NodeServices.layer))
);
