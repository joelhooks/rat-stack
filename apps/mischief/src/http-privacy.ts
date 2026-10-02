import { Effect, Layer } from "effect";
import { HttpMiddleware, HttpRouter } from "effect/http";

import { UNSUBSCRIBE_PATH } from "./interest/unsubscribe.js";

export const privateMcpTracingLayer = HttpRouter.middleware((httpEffect) =>
  httpEffect.pipe(Effect.withTracerEnabled(false))
).layer;

export const privateHttpTracingLayer = Layer.effect(
  HttpMiddleware.TracerDisabledWhen,
  Effect.gen(function* privateHttpTracing() {
    const previous = yield* HttpMiddleware.TracerDisabledWhen;

    return (request) => {
      const url = new URL(request.url, "https://ratstack.sh");

      return (
        previous(request) ||
        url.pathname.startsWith("/operator/interest") ||
        url.pathname === UNSUBSCRIBE_PATH ||
        [...url.searchParams.keys()].some((key) =>
          ["t", "token", "ticket"].includes(key.toLowerCase())
        )
      );
    };
  })
);
