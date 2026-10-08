import { BetterAuth } from "@alchemy.run/better-auth";
import type { BetterAuthProps } from "@alchemy.run/better-auth";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import { DatabaseVendor } from "@rat-stack/database";
import { Effect, Layer, Match } from "effect";

import { authOptions } from "./auth-options.js";
import { AuthService } from "./auth-service.js";

export const d1AuthLayer = (options: {
  readonly baseURL: string;
  readonly id: string;
  readonly secret: Exclude<BetterAuthProps["secret"], undefined>;
}) =>
  Layer.unwrap(
    Effect.gen(function* makeD1Auth() {
      const vendor = yield* DatabaseVendor;

      const database = yield* Match.value(vendor).pipe(
        Match.tag("D1", (d1) => Effect.succeed(d1.database)),
        Match.orElse(() =>
          Effect.die(
            new Error(
              "The private feedback auth Worker requires its D1 vendor."
            )
          )
        )
      );

      const configured: typeof authOptions &
        Pick<BetterAuthProps, "baseURL" | "id" | "secret"> = {
        ...authOptions,
        ...options,
      };

      return Layer.effect(
        AuthService,
        BetterAuth(configured).pipe(Effect.provide(CloudflareD1(database)))
      );
    })
  );
