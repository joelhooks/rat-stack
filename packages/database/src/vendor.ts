import type * as Cloudflare from "@alchemy.run/cloudflare";
import type { StaticConnectionSource } from "@alchemy.run/sql/ConnectionSource";
import { Context } from "effect";

export type DatabaseVendorResource =
  | {
      readonly _tag: "D1";
      readonly database: Cloudflare.D1.Database;
    }
  | {
      readonly _tag: "HyperdrivePostgres";
      readonly connection: Cloudflare.Hyperdrive.Connection;
      readonly migrationUrl: StaticConnectionSource;
    };

export class DatabaseVendor extends Context.Service<
  DatabaseVendor,
  DatabaseVendorResource
>()("@rat-stack/database/DatabaseVendor") {}
