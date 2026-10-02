import { Context, Effect, Layer, Predicate, Schema } from "effect";

import { AssetReadError } from "./static-assets-error.js";

export interface AssetBinding {
  readonly fetch: (request: Request) => Promise<Response>;
}

export const AssetBindingSchema = Schema.declare<AssetBinding>(
  (value): value is AssetBinding =>
    Predicate.isObject(value) &&
    "fetch" in value &&
    Predicate.isFunction(value.fetch)
);

const readAsset = Effect.fn("StaticAssets.read")(function* readAsset(
  binding: AssetBinding,
  path: string
) {
  const response = yield* Effect.tryPromise({
    catch: (cause) => new AssetReadError({ cause, path, reason: "provider" }),
    try: binding.fetch.bind(
      binding,
      new Request(new URL(path, "https://assets.invalid"))
    ),
  });

  if (response.status !== 200) {
    return yield* new AssetReadError({
      cause: response.status,
      path,
      reason: "response",
    });
  }

  const bytes = new Uint8Array(
    yield* Effect.tryPromise({
      catch: (cause) => new AssetReadError({ cause, path, reason: "provider" }),
      try: response.arrayBuffer.bind(response),
    })
  );

  if (bytes.byteLength === 0) {
    return yield* new AssetReadError({
      cause: "Asset body is empty",
      path,
      reason: "empty",
    });
  }

  return bytes;
});

export class StaticAssets extends Context.Service<
  StaticAssets,
  {
    readonly read: (path: string) => Effect.Effect<Uint8Array, AssetReadError>;
  }
>()("mischief/StaticAssets") {
  static readonly unavailable = StaticAssets.of({
    read: (path) =>
      Effect.fail(
        new AssetReadError({
          cause: "ASSETS binding is missing",
          path,
          reason: "binding",
        })
      ),
  });

  static readonly layer = (binding: AssetBinding) =>
    Layer.succeed(
      StaticAssets,
      StaticAssets.of({ read: (path) => readAsset(binding, path) })
    );
}
