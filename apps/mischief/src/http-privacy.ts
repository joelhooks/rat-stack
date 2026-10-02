import { Effect, Layer } from "effect";
import { HttpMiddleware } from "effect/http";

import { UNSUBSCRIBE_PATH } from "./interest/unsubscribe.js";

export const privateHttpTracingLayer = Layer.effect(
  HttpMiddleware.TracerDisabledWhen,
  Effect.gen(function* privateHttpTracing() {
    const previous = yield* HttpMiddleware.TracerDisabledWhen;

    return (request) => {
      const url = new URL(request.url, "https://ratstack.sh");

      return (
        previous(request) ||
        url.pathname === UNSUBSCRIBE_PATH ||
        [...url.searchParams.keys()].some((key) =>
          ["t", "token", "ticket"].includes(key.toLowerCase())
        )
      );
    };
  })
);
