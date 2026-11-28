import { Effect } from "effect";

import { instituteVisibilityFor } from "../../../../site/src/institute-visibility.js";
import type { AssetFetch } from "./artifact.js";

export const instituteWebsiteRuntime = Effect.tryPromise(
  () => import("cloudflare:workers")
).pipe(
  Effect.map(({ env }) => {
    const { enabled, discoverable } = instituteVisibilityFor(env);
    const binding = env.ASSETS;

    if (!enabled || binding === undefined) {
      return null;
    }

    const fetchAsset: AssetFetch = (request) => binding.fetch(request);

    return { discoverable, fetchAsset };
  }),
  Effect.orElseSucceed(() => null)
);
