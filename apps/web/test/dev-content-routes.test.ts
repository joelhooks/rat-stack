import { expect, it } from "@effect/vitest";
import { contentCapabilities } from "@rat-stack/mischief/capabilities";
import { nodeContentLayer as contentLayer } from "@rat-stack/mischief/node-content";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/http";

import { contentRoutes } from "../src/dev/content-routes.js";

const RpcExit = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Struct({
      exit: Schema.TaggedStruct("Success", {
        value: Schema.Struct({ total: Schema.Int }),
      }),
    }),
  ])
);

it.effect("serves search over /rpc with no devtools involved", () =>
  Effect.gen(function* servesContent() {
    const { dispose, handler } = HttpRouter.toWebHandler(
      contentRoutes(contentCapabilities).pipe(Layer.provide(contentLayer)),
      { disableLogger: true }
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    const request = {
      // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- This is the Effect RPC wire message the browser sends; the test writes it by hand on purpose.
      _tag: "Request",
      headers: [],
      id: "1",
      payload: { limit: 1, query: "capability" },
      tag: "search",
    };

    const response = yield* Effect.promise(
      // @effect-diagnostics-next-line asyncFunction:off -- The Effect web handler is a Promise boundary.
      async () =>
        await handler(
          new Request("http://dev.test/rpc", {
            body: JSON.stringify(request),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        )
    );

    const body = yield* Effect.promise(response.text.bind(response));
    const [message] = yield* Schema.decodeUnknownEffect(RpcExit)(body);

    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body).not.toContain("AssetReadError");

    expect(response.status).toBe(200);
    expect(message.exit.value.total).toBe(1);
  })
);
