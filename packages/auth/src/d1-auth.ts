import type { BetterAuthProps } from "@alchemy.run/better-auth";
import { Effect, Layer } from "effect";

export const d1AuthLayer = (options: {
  readonly baseURL: string;
  readonly id: string;
  readonly secret: Exclude<BetterAuthProps["secret"], undefined>;
}) =>
  Layer.unwrap(
    Effect.promise(() => import("./d1-auth-live.js")).pipe(
      Effect.map((module) => module.d1AuthLayer(options))
    )
  );
