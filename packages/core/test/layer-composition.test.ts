import { expect, it } from "@effect/vitest";
import { Effect, Layer, Ref } from "effect";

import { ConstructionCount } from "./fixtures/layer-composition/construction-count.js";
import { ReadAccess } from "./fixtures/layer-composition/read-access.js";
import { Resource } from "./fixtures/layer-composition/resource.js";
import { WriteAccess } from "./fixtures/layer-composition/write-access.js";

it.effect.each([
  { constructions: 1, shared: true },
  { constructions: 2, shared: false },
])(
  "Layer identity controls construction: $shared",
  ({ constructions, shared }) =>
    Effect.gen(function* countConstruction() {
      const resource = Resource.layer();

      const graph = Layer.merge(
        ReadAccess.layer.pipe(Layer.provide(resource)),
        WriteAccess.layer.pipe(
          Layer.provide(shared ? resource : Resource.layer())
        )
      );

      const ids = yield* Effect.gen(function* readServiceIds() {
        return [yield* ReadAccess, yield* WriteAccess];
      }).pipe(Effect.provide(graph));

      const count = yield* ConstructionCount;

      expect(yield* Ref.get(count)).toBe(constructions);
      expect(ids[0] === ids[1]).toBe(shared);
    }).pipe(Effect.provide(ConstructionCount.layer))
);
