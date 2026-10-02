import { Context, Effect, Layer, Option, Predicate, Schema } from "effect";

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
    catch: (cause) => new AssetReadError({ cause, path }),
    try: binding.fetch.bind(
      binding,
      new Request(new URL(path, "https://assets.invalid"))
    ),
  });

  if (response.status !== 200) {
    return Option.none<Uint8Array>();
  }

  const body = yield* Effect.tryPromise({
    catch: (cause) => new AssetReadError({ cause, path }),
    try: response.arrayBuffer.bind(response),
  });

  return Option.some(new Uint8Array(body));
});

export class StaticAssets extends Context.Service<
  StaticAssets,
  {
    readonly read: (
      path: string
    ) => Effect.Effect<Option.Option<Uint8Array>, AssetReadError>;
  }
>()("mischief/StaticAssets") {
  static readonly layer = (binding: AssetBinding) =>
    Layer.succeed(
      StaticAssets,
      StaticAssets.of({ read: (path) => readAsset(binding, path) })
    );
}
