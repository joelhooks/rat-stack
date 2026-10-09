import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";

import { privateNativeTracerLayer } from "../../../mischief/src/observability.js";
import type { BackendFetch } from "./rpc.js";
import { WebsiteBindingError } from "./website-binding-error.js";

const WebsiteEnvironment = Schema.Struct({
  BACKEND: Schema.declare<{ readonly fetch: BackendFetch }>(
    (input): input is { readonly fetch: BackendFetch } =>
      Predicate.isObject(input) &&
      Predicate.hasProperty(input, "fetch") &&
      Predicate.isFunction(input.fetch)
  ),
  PREVIEW_COMMIT: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u))
  ),
  TRACES_ENABLED: Schema.optionalKey(Schema.Literals(["true", "false"])),
});

const importRuntime = Effect.tryPromise({
  catch: (cause) =>
    new WebsiteBindingError({
      cause,
      message: "Website bindings require the Cloudflare Worker runtime",
    }),
  // @effect-diagnostics-next-line asyncFunction:off -- Effect.tryPromise owns the lazy Cloudflare module import boundary.
  try: async () => await import("cloudflare:workers"),
});

const runtimeEnvironment = importRuntime.pipe(
  Effect.flatMap(({ env }) =>
    Schema.decodeUnknownEffect(WebsiteEnvironment)(env)
  ),
  Effect.mapError(
    (cause) =>
      new WebsiteBindingError({
        cause,
        message:
          "Website requires BACKEND and a valid optional PREVIEW_COMMIT binding",
      })
  )
);

const WebsiteTraceEnvironment = Schema.Struct({
  TRACES_ENABLED: WebsiteEnvironment.fields.TRACES_ENABLED,
});

export const websiteTelemetryFor = (
  environment: typeof WebsiteTraceEnvironment.Type
) =>
  environment.TRACES_ENABLED === "true"
    ? privateNativeTracerLayer
    : Layer.empty;

export const websiteTelemetry = Layer.unwrap(
  importRuntime.pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(Layer.empty),
        onSome: ({ env }) =>
          Schema.decodeUnknownEffect(WebsiteTraceEnvironment)(env).pipe(
            Effect.orDie,
            Effect.map(websiteTelemetryFor)
          ),
      })
    )
  )
);

export class WebsiteBindings extends Context.Service<
  WebsiteBindings,
  {
    readonly forward: (
      request: Request
    ) => Effect.Effect<Response, WebsiteBindingError>;
    readonly previewCommit: Effect.Effect<
      string | undefined,
      WebsiteBindingError
    >;
  }
>()("@rat-stack/web/WebsiteBindings", {
  make: Effect.succeed({
    forward: Effect.fn("WebsiteBindings.forward")(function* forward(
      request: Request
    ) {
      const bindings = yield* runtimeEnvironment;

      return yield* Effect.tryPromise({
        catch: (cause) =>
          new WebsiteBindingError({
            cause,
            message:
              "RpcBackend forwarding failed; inspect the private service binding",
          }),
        // @effect-diagnostics-next-line asyncFunction:off -- Effect.tryPromise owns the service binding Promise boundary.
        try: async () => await bindings.BACKEND.fetch(request),
      });
    }),
    previewCommit: runtimeEnvironment.pipe(
      Effect.map((bindings) => bindings.PREVIEW_COMMIT)
    ),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);

  static readonly testLayer = (service: WebsiteBindings["Service"]) =>
    Layer.succeed(this, service);
}
