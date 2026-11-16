import type * as Cloudflare from "@alchemy.run/cloudflare";
import type { StaticConnectionSource } from "@alchemy.run/sql/ConnectionSource";
import { Context } from "effect";
import type { Data } from "effect";

export type DatabaseVendorResource = Data.TaggedEnum<{
  D1: { readonly database: Cloudflare.D1.Database };
  HyperdrivePostgres: {
    readonly connection: Cloudflare.Hyperdrive.Connection;
    readonly migrationUrl: StaticConnectionSource;
  };
}>;

export class DatabaseVendor extends Context.Service<
  DatabaseVendor,
  DatabaseVendorResource
>()("@rat-stack/database/DatabaseVendor") {}
