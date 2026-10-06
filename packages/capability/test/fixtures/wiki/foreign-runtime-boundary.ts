import { Effect, ManagedRuntime } from "effect";
import type { Ref } from "effect";

import { BoundaryResource } from "./boundary-resource.js";

export const makeForeignRuntimeBoundary = (options: {
  readonly acquired: Ref.Ref<number>;
  readonly released: Ref.Ref<number>;
}) => {
  const runtime = ManagedRuntime.make(BoundaryResource.layer(options));

  const read = Effect.gen(function* readBoundaryResource() {
    const resource = yield* BoundaryResource;

    return yield* resource.read;
  });

  return {
    close: runtime.dispose.bind(runtime),
    // @effect-diagnostics-next-line asyncFunction:off -- This foreign framework boundary exposes a native Promise API.
    read: async () => await runtime.runPromise(read),
  };
};
