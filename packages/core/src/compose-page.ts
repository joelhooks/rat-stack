import { implement } from "@rat-stack/capability/implement";
import { Effect, Schema } from "effect";

import { composePageContract, InvalidPage, PageSpec } from "./contracts.js";

export const composePage = implement(
  composePageContract,
  Effect.fn("composePage")(function* compose(input) {
    const { inspectCatalogPage } = yield* Effect.promise(
      // @effect-diagnostics-next-line asyncFunction:off -- Dynamic import is the deliberate cold code-loading boundary.
      async () => await import("./page-catalog.js")
    );

    const result = inspectCatalogPage(input.spec);

    if (result.spec === undefined) {
      return yield* new InvalidPage({ issues: result.issues });
    }

    return yield* Schema.decodeUnknownEffect(PageSpec)(result.spec).pipe(
      Effect.orDie
    );
  })
);
