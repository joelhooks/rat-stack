import { Context, Effect, Layer, Ref } from "effect";

export class BoundaryResource extends Context.Service<
  BoundaryResource,
  { readonly read: Effect.Effect<string> }
>()("wiki/BoundaryResource") {
  static layer(options: {
    readonly acquired: Ref.Ref<number>;
    readonly released: Ref.Ref<number>;
  }) {
    return Layer.effect(
      this,
      Effect.acquireRelease(
        Effect.sync(() => ({ read: Effect.succeed("ready") })).pipe(
          Effect.tap(() => Ref.update(options.acquired, (count) => count + 1))
        ),
        () => Ref.update(options.released, (count) => count + 1)
      )
    );
  }
}
