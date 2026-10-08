import { BetterAuth, Memory } from "@alchemy.run/better-auth";
import type { BetterAuthProps } from "@alchemy.run/better-auth";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import { CloudflareHyperdrive } from "@alchemy.run/better-auth/CloudflareHyperdrive";
import { DatabaseVendor } from "@rat-stack/database";
import { Effect, Layer, Match } from "effect";

import { authOptions } from "./auth-options.js";
import { AuthService } from "./auth-service.js";

export { authOptions } from "./auth-options.js";

export type { AuthInstance } from "./auth-options.js";

export interface AuthLayerOptions {
  readonly baseURL?: string;
  readonly id?: string;
  readonly secret?: BetterAuthProps["secret"];
}

export interface MemoryLayerOptions {
  readonly baseURL?: string;
}

// @effect-diagnostics-next-line leakingRequirements:off -- Better Auth methods intentionally retain per-request RuntimeContext requirements.
export class Auth extends AuthService {
  static layer(options: AuthLayerOptions = {}) {
    return Layer.unwrap(
      Effect.gen(function* buildAuthLayer() {
        const vendor = yield* DatabaseVendor;

        const database = Match.value(vendor).pipe(
          Match.tags({
            D1: (d1) => CloudflareD1(d1.database),
            HyperdrivePostgres: (postgres) =>
              CloudflareHyperdrive(postgres.connection, {
                migrate: postgres.migrationUrl,
              }),
          }),
          Match.exhaustive
        );

        const optionsWithId =
          options.id === undefined
            ? authOptions
            : { ...authOptions, id: options.id };

        const optionsWithUrl =
          options.baseURL === undefined
            ? optionsWithId
            : { ...optionsWithId, baseURL: options.baseURL };

        const configuredOptions =
          options.secret === undefined
            ? optionsWithUrl
            : { ...optionsWithUrl, secret: options.secret };

        return Layer.effect(
          Auth,
          BetterAuth(configuredOptions).pipe(Effect.provide(database))
        );
      })
    );
  }

  static memoryLayer(secret: string, options: MemoryLayerOptions = {}) {
    const configured =
      options.baseURL === undefined
        ? { ...authOptions, secret }
        : { ...authOptions, baseURL: options.baseURL, secret };

    return Layer.effect(
      Auth,
      BetterAuth(configured).pipe(Effect.provide(Memory()))
    );
  }
}
