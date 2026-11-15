import { NodeRuntime } from "@effect/platform-node";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CatalogSmokeFailed, smokeCatalog } from "./Smoke.ts";

const target = Schema.URLFromString.check(
  Schema.makeFilter(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      url.username === "" &&
      url.password === ""
  )
);

const program = Effect.gen(function* runCatalogSmoke() {
  const url = yield* Schema.decodeUnknownEffect(target)(process.argv[2]);
  const token = yield* Config.Redacted("CATALOG_OPERATOR_TOKEN");

  yield* smokeCatalog(url.toString(), token);
  yield* Console.log(
    "PASS unauthenticated ItemHistory.get returned Unauthorized"
  );
  yield* Console.log(
    "PASS authenticated ItemHistory.get accepted the operator token"
  );
}).pipe(
  Effect.catchCause((cause) => {
    const failure = Cause.findErrorOption(cause);

    return Effect.fail(
      Option.isSome(failure) && Schema.is(CatalogSmokeFailed)(failure.value)
        ? failure.value
        : CatalogSmokeFailed.forPhase("configuration-or-transport")
    );
  }),
  Effect.provide(FetchHttpClient.layer)
);

NodeRuntime.runMain(program);
