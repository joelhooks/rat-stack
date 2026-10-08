import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  databaseMigrationDirectory,
  databaseSchemaFile,
} from "./migrations.js";
import { RunLogLayer } from "./run-log-vendor.js";
import { DatabaseVendor } from "./vendor.js";

export interface D1Options {
  readonly id: string;
}

const makeD1Vendor = Effect.fn("makeD1Vendor")(function* makeD1Vendor({
  id,
}: D1Options) {
  const migrations = yield* Drizzle.Schema(`${id}-d1-schema`, {
    dialect: "sqlite",
    out: databaseMigrationDirectory("d1"),
    schema: databaseSchemaFile("d1"),
  });

  const database = yield* Cloudflare.D1.Database(`${id}-d1`, { migrations });

  return { _tag: "D1" as const, database };
});

export const D1Vendor = (options: D1Options) =>
  Layer.effect(DatabaseVendor, makeD1Vendor(options));

export const D1 = (options: D1Options) =>
  Layer.unwrap(
    Effect.gen(function* buildD1Layer() {
      const vendor = yield* makeD1Vendor(options);

      return Layer.mergeAll(
        RunLogLayer(vendor),
        Layer.succeed(DatabaseVendor, vendor)
      );
    })
  ).pipe(Layer.provide(Cloudflare.D1.QueryDatabaseBinding));
