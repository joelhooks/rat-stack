import { Context, Effect, Layer, Ref } from "effect";

import { ConstructionCount } from "./construction-count.js";

export class Resource extends Context.Service<
  Resource,
  { readonly id: number }
>()("@rat-stack/core/test/Resource", {
  make: Effect.gen(function* makeResource() {
    const count = yield* ConstructionCount;
    const id = yield* Ref.updateAndGet(count, (current) => current + 1);

    return { id };
  }),
}) {
  static layer() {
    return Layer.effect(this, this.make);
  }
}
