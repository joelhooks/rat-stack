import { Context, Layer, Ref } from "effect";

export class ConstructionCount extends Context.Service<
  ConstructionCount,
  Ref.Ref<number>
>()("@rat-stack/core/test/ConstructionCount") {
  static readonly layer = Layer.effect(this, Ref.make(0));
}
