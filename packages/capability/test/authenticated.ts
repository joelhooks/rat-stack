import { Context, Effect, Layer, Schema } from "effect";
import { HttpServerRequest } from "effect/unstable/http";
import { HttpApiMiddleware } from "effect/unstable/httpapi";

export interface CallerService {
  readonly name: string;
}

export const Caller = Context.Service<CallerService, CallerService>(
  "@rat-stack/capability/test/Caller"
);

const Unauthenticated = Schema.TaggedStruct("Unauthenticated", {}).annotate({
  httpApiStatus: 401,
});

export class Authenticated extends HttpApiMiddleware.Service<
  Authenticated,
  { provides: CallerService }
>()("@rat-stack/capability/test/Authenticated", { error: Unauthenticated }) {}

export const AuthenticatedLayer = Layer.succeed(
  Authenticated,
  Effect.fn(function* authenticate(httpEffect) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const name = request.headers["x-caller"];

    if (name === undefined) {
      return yield* Effect.fail(Unauthenticated.make({}));
    }

    return yield* Effect.provideService(httpEffect, Caller, { name });
  })
);
